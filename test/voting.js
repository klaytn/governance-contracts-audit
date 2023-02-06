const _ = require("lodash");
const { expect } = require("chai");
const { constants } = require("@openzeppelin/test-helpers");
const { augmentChai, nowBlock, setBlock, getBalance,
        toPeb, addPebs, numericAddr, expectRevert } = require("./helper.js");
const { StakingContract, StakingConf,buildUniformCnOpts,
        build50x2cnOpts } = require("./helper_conf.js");

const NULL_ADDR = constants.ZERO_ADDRESS;

const ProposalState = {
    Pending: 0,
    Active: 1,
    Canceled: 2,
    Failed: 3,
    Passed: 4,
    Queued: 5,
    Expired: 6,
    Executed: 7,
};
const VoteChoice = {
    No: 0,
    Yes: 1,
    Abstain: 2,
};

class StakingTrackerConf extends StakingConf {
  constructor(opts, envs) {
    super(opts, envs);
    this._stAddr = null;
  }

  get stAddr() { return this._stAddr; }
  get deployed() { return this._stAddr != null; } // override

  async deploy() { // override
    await this.deployCnsAbook();
    await this.deploySt();
  }
  async deploySt() {
    let ownerAddr = this.envs.deployer.address;

    let st = await this.envs.StakingTracker.deploy();
    await st.mockSetOwner(ownerAddr);
    await st.mockSetAddressBookAddress(this.abookAddr);

    this._stAddr = st.address;
    if (0) console.log('Deploy(#nodes, #cns, abook, st)=',
      this._cnsAddrs.length, this.cnsAddrsList.length, this._abookAddr, this._stAddr);
  }
}

class VotingTestEnv {

  constructor() {
  }

  async _createEnv() {
    this.accounts = await hre.ethers.getSigners();

    this.AddressBook = await ethers.getContractFactory("AddressBookMock");
    this.CnStakingV2 = await ethers.getContractFactory("CnStakingV2Mock");
    this.StakingTracker = await ethers.getContractFactory("StakingTrackerMock");
    this.Voting = await ethers.getContractFactory("VotingMock");

    this.conf1cn = this.createConf({ balances: [
      [5e6] ]}); // 1 vote
    this.conf3cn = this.createConf({ balances: [
      [10e6], [10e6], [5e6] ]}); // 2,2,1 votes
    this.conf5cn = this.createConf({ balances: [
      [15e6], [10e6], [5e6], [5e6], [1e6] ]}); // 3,2,1,1,0 votes
    this.conf50cn = this.createConf(buildUniformCnOpts(50));

    await this.conf1cn.deployOnce();
    await this.appointVoter(this.conf1cn, 0, this.voter1);

    await this.conf3cn.deployOnce();
    await this.appointVoter(this.conf3cn, 0, this.voter1);
    await this.appointVoter(this.conf3cn, 1, this.voter2);
    await this.appointVoter(this.conf3cn, 2, this.voter3);

    await this.conf5cn.deployOnce();
    await this.appointVoter(this.conf5cn, 0, this.voter1);
    await this.appointVoter(this.conf5cn, 1, this.voter2);
    await this.appointVoter(this.conf5cn, 2, this.voter3);
    await this.appointVoter(this.conf5cn, 3, this.voter4);
    await this.appointVoter(this.conf5cn, 4, this.voter5);
  }

  // Constants
  get State() { return ProposalState; }
  get Choice() { return VoteChoice; }

  // Sample accounts
  get deployer() { return this.accounts[0]; }
  get admin1()   { return this.accounts[1]; } // intended use is CnStaking admin
  get voter1()   { return this.accounts[2]; }
  get voter2()   { return this.accounts[3]; }
  get voter3()   { return this.accounts[4]; }
  get voter4()   { return this.accounts[5]; }
  get voter5()   { return this.accounts[6]; }
  get secr1()    { return this.accounts[7]; }
  get secr2()    { return this.accounts[8]; }
  get other1()   { return this.accounts[9]; }

  // Sample data
  get targets()      { return [this.other1.address]; }
  get values()       { return [toPeb(1)]; }
  get calldatas()    { return ["0x"]; }
  get signatures()   { return [""]; }
  get description()  { return "lorem ipsum"; }
  get votingDelay()  { return 86400*7; }
  get votingPeriod() { return 86400*7; }
  get zeroActions()  { return { targets: [], values: [], calldatas: [] }; }

  // staking configurations
  createConf(opts, envs) {
    envs = envs || {};
    envs.AddressBook    = envs.AddressBook    || this.AddressBook;
    envs.CnStaking      = envs.CnStaking      || this.CnStakingV2;
    envs.StakingTracker = envs.StakingTracker || this.StakingTracker;
    envs.deployer       = envs.deployer       || this.deployer; // CnStaking contractValidator
    envs.admin          = envs.admin          || this.admin1;   // CnStaking admin
    envs.owner          = envs.owner          || this.deployer; // StakingTracker owner
    return new StakingTrackerConf(opts, envs)
  };

  // Deploy

  async deploy(conf, secrAddr) {
    var conf = conf || this.conf1cn;
    var stAddr = conf.stAddr;
    var secrAddr = secrAddr || this.secr1.address;

    let vo = await this.Voting.deploy(stAddr, secrAddr);
    // Instead of re-deploying ST, change owner of the pre-deployed ST.
    let st = await this.StakingTracker.attach(stAddr);
    await st.mockSetOwner(vo.address);
    return vo;
  }

  async get_st(vo) {
    let stAddr = await vo.stakingTracker();
    return await this.StakingTracker.attach(stAddr);
  }

  async appointVoter(conf, index, voter) {
    let voterAddr = voter.address || voter;
    let gcId      = 700 + index;
    let stAddr    = conf.stAddr;
    let st        = await this.StakingTracker.attach(stAddr);
    let cnsAddr   = conf.cnsAddrs[index][0];
    let cns       = await this.CnStakingV2.attach(cnsAddr);

    await expect(cns.connect(this.admin1).submitUpdateStakingTracker(stAddr))
      .to.emit(cns, "UpdateStakingTracker").withArgs(stAddr);
    await expect(cns.connect(this.admin1).submitUpdateVoterAddress(voterAddr))
      .to.emit(cns, "UpdateVoterAddress").withArgs(voterAddr)
      .to.emit(st, "RefreshVoter").withArgs(gcId, cnsAddr, voterAddr);
  }

  // Propose

  parseProposeArgs(args) {
    args = args || {};
    args.description  = args.description  || this.description;
    args.targets      = args.targets      || this.targets;
    args.values       = args.values       || this.values;
    args.signatures   = args.signatures   || _.fill(Array(args.targets.length), "");
    args.calldatas    = args.calldatas    || this.calldatas;
    args.votingDelay  = args.votingDelay  || this.votingDelay;
    args.votingPeriod = args.votingPeriod || this.votingPeriod;
    return args;
  }
  tx_propose(vo, sender, args) {
    args = this.parseProposeArgs(args);
    return vo.connect(sender).propose(
      args.description,
      args.targets,
      args.values,
      args.calldatas,
      args.votingDelay,
      args.votingPeriod);
  }
  async must_propose(vo, sender, args) {
    args = this.parseProposeArgs(args);

    let pid = parseInt(await vo.lastProposalId()) + 1;

    let stAddr = await vo.stakingTracker();
    let st     = await this.StakingTracker.attach(stAddr);

    let proposeBlock = (await nowBlock()) + 1;
    let voteStart = proposeBlock + args.votingDelay;
    let voteEnd   = voteStart    + args.votingPeriod;

    await expect(this.tx_propose(vo, sender, args))
      .to.emit(st, "CreateTracker").withArgs(proposeBlock, voteStart)
      .to.emit(vo, "ProposalCreated").withArgs(
        pid, sender.address, // proposalId, proposer
        args.targets, args.values, args.signatures, args.calldatas,
        voteStart, voteEnd, args.description);

    await this.check_state(vo, pid, 'Pending');
    return pid;
  }
  async revert_propose(vo, sender, args, msg) {
    args = this.parseProposeArgs(args);
    await expectRevert(this.tx_propose(vo, sender, args), msg);
  }

  // Cancel

  tx_cancel(vo, sender, pid) {
    return vo.connect(sender).cancel(pid);
  }
  async must_cancel(vo, sender, pid) {
    await expect(this.tx_cancel(vo, sender, pid))
      .to.emit(vo, "ProposalCanceled").withArgs(pid);

    await this.check_state(vo, pid, 'Canceled');
    let schedule = await vo.getProposalSchedule(pid);
    expect(schedule[5]).to.equal(true); // canceled;
  }
  async revert_cancel(vo, sender, pid, msg) {
    await expectRevert(this.tx_cancel(vo, sender, pid), msg);
  }

  // Vote

  tx_vote(vo, sender, pid, choice) {
    if (_.isString(choice)) {
      choice = this.Choice[choice];
    }
    return vo.connect(sender).castVote(pid, choice);
  }
  async must_vote(vo, sender, pid, choice) {
    let [ gcId, votes ] = await vo.getVotes(pid, sender.address);

    if (_.isString(choice)) {
      choice = this.Choice[choice];
    }
    let [deltaYes, deltaNo, deltaAbstain] = [0, 0, 0];
    if (choice == this.Choice.Yes)     { deltaYes     = votes; }
    if (choice == this.Choice.No)      { deltaNo      = votes; }
    if (choice == this.Choice.Abstain) { deltaAbstain = votes; }

    let pre = await vo.getProposalTally(pid);

    await expect(this.tx_vote(vo, sender, pid, choice))
      .to.emit(vo, "VoteCast").withArgs(sender.address, pid, choice, votes, gcId);

    let post = await vo.getProposalTally(pid);
    let voteRc = await vo.getReceipt(pid, gcId);

    expect(post[0]).to.equal(pre[0].add(deltaYes));     // totalYes += deltaYes
    expect(post[1]).to.equal(pre[1].add(deltaNo));      // totalYes += deltaYes
    expect(post[2]).to.equal(pre[2].add(deltaAbstain)); // totalYes += deltaYes
    expect(post[3]).to.equal(pre[3]);                   // quorumCount unchanged
    expect(post[4]).to.equal(pre[4]);                   // quorumPower unchanged
    expect(post[5]).to.equalNumberList(_.concat(pre[5], gcId)); // voters += gcId

    expect(voteRc[0]).to.equal(true); // hasVoted
    expect(voteRc[1]).to.equal(choice);
    expect(voteRc[2]).to.equal(votes);
  }
  async revert_vote(vo, sender, pid, choice, msg) {
    await expectRevert(this.tx_vote(vo, sender, pid, choice), msg);
  }

  // Queue and execute

  tx_queue(vo, sender, pid) {
    return vo.connect(sender).queue(pid);
  }
  async must_queue(vo, sender, pid) {
    let queueBlock   = (await nowBlock()) + 1;
    let eta          = queueBlock + parseInt(await vo.execDelay());
    let execDeadline = eta        + parseInt(await vo.execTimeout());

    await expect(this.tx_queue(vo, sender, pid))
      .to.emit(vo, "ProposalQueued").withArgs(pid, eta);

    await this.check_state(vo, pid, 'Queued');
    let schedule = await vo.getProposalSchedule(pid);
    expect(schedule[3]).to.equal(eta);
    expect(schedule[4]).to.equal(execDeadline);
    expect(schedule[6]).to.equal(true); // queued
  }
  async revert_queue(vo, sender, pid, msg) {
    await expectRevert(this.tx_queue(vo, sender, pid), msg);
  }

  tx_execute(vo, sender, pid, value) {
    value = value || 0;
    return vo.connect(sender).execute(pid, { value: value });
  }
  async must_execute(vo, sender, pid, value) {
    value = value || await this.get_totalValue(vo, pid);
    await expect(this.tx_execute(vo, sender, pid, value))
      .to.emit(vo, "ProposalExecuted").withArgs(pid);

    await this.check_state(vo, pid, 'Executed');

    let schedule = await vo.getProposalSchedule(pid);
    expect(schedule[7]).to.equal(true); // executed
  }
  async revert_execute(vo, sender, pid, value, msg) {
    await expectRevert(this.tx_execute(vo, sender, pid, value), msg);
  }

  // Rules

  tx_updateStakingTracker(vo, sender, newAddr) {
    return this.tx_govFunction(vo, sender, "updateStakingTracker", [newAddr]);
  }
  async must_updateStakingTracker(vo, sender, newAddr) {
    let oldAddr = await vo.stakingTracker();
    await expect(this.tx_updateStakingTracker(vo, sender, newAddr))
      .to.emit(vo, "UpdateStakingTracker").withArgs(oldAddr, newAddr);
    expect(await vo.stakingTracker()).to.equal(newAddr);
  }
  async revert_updateStakingTracker(vo, sender, newAddr, msg) {
    await expectRevert(this.tx_updateStakingTracker(vo, sender, newAddr), msg);
  }

  tx_updateSecretary(vo, sender, newAddr) {
    return this.tx_govFunction(vo, sender, "updateSecretary", [newAddr]);
  }
  async must_updateSecretary(vo, sender, newAddr) {
    let oldAddr = await vo.secretary();
    await expect(this.tx_updateSecretary(vo, sender, newAddr))
      .to.emit(vo, "UpdateSecretary").withArgs(oldAddr, newAddr);
    expect(await vo.secretary()).to.equal(newAddr);
  }
  async revert_updateSecretary(vo, sender, newAddr, msg) {
    await expectRevert(this.tx_updateSecretary(vo, sender, newAddr), msg);
  }

  tx_updateAccessRule(vo, sender, rule) {
    return this.tx_govFunction(vo, sender, "updateAccessRule", rule);
  }
  async must_updateAccessRule(vo, sender, rule) {
    await expect(this.tx_updateAccessRule(vo, sender, rule))
      .to.emit(vo, "UpdateAccessRule").withArgs(...rule);
    await this.check_accessRule(vo, rule);
  }
  async revert_updateAccessRule(vo, sender, rule, msg) {
    await expectRevert(this.tx_updateAccessRule(vo, sender, rule), msg);
  }

  tx_updateTimingRule(vo, sender, rule) {
    return this.tx_govFunction(vo, sender, "updateTimingRule", rule);
  }
  async must_updateTimingRule(vo, sender, rule) {
    await expect(this.tx_updateTimingRule(vo, sender, rule))
      .to.emit(vo, "UpdateTimingRule").withArgs(...rule);
    await this.check_timingRule(vo, rule);
  }
  async revert_updateTimingRule(vo, sender, rule, msg) {
    await expectRevert(this.tx_updateTimingRule(vo, sender, rule), msg);
  }

  // If sender != null, return the TX that directly calls the given function.
  // If sender == null, create a proposal that executes the given function,
  // cast majority vote, queue, then return the TX that executes the proposal.
  async tx_govFunction(vo, sender, funcName, funcArgs) {
    if (sender != null) {
      // Direct call by sender
      return vo.connect(sender)[funcName](...funcArgs);
    } else {
      // Call into Voting itself, through a passed proposal
      let tx = await vo.connect(sender).populateTransaction[funcName](...funcArgs);
      let args = {
        targets: [vo.address],
        values: [0],
        calldatas: [tx.data] };

      let pid = await this.createProposalAt(vo, 'Queued', args);
      await this.wait_eta(vo, pid);

      return this.tx_execute(vo, this.secr1, pid, 0);
    }
  }

  // State

  async createProposalAt(vo, state, args) {
    let E = this;
    let pid = await E.must_propose(vo, E.secr1, args);

    let schedule = await vo.getProposalSchedule(pid);
    let voteStart     = parseInt(schedule[0]);
    let voteEnd       = parseInt(schedule[1]);
    let queueDeadline = parseInt(schedule[2]);

    if (state == 'Pending') {
      // do nothing
    }
    else if (state == 'Canceled') {
      await E.must_cancel(vo, E.secr1, pid);
    }
    else if (state == 'Active') {
      await setBlock(voteStart);
    }
    else if (state == 'Passed') {
      // in [conf1cn, conf3cn, conf5cn], voter1 alone is enough to pass the proposal.
      await setBlock(voteStart);
      await E.must_vote(vo, E.voter1, pid, 'Yes');
      await setBlock(voteEnd + 1);
    }
    else if (state == 'Failed') {
      await setBlock(voteEnd + 1);
    }
    else if (state == 'Queued') {
      await setBlock(voteStart);
      await E.must_vote(vo, E.voter1, pid, 'Yes');
      await setBlock(voteEnd + 1);
      await E.must_queue(vo, E.secr1, pid);
    }
    else if (state == 'Executed') {
      await setBlock(voteStart);
      await E.must_vote(vo, E.voter1, pid, 'Yes');
      await setBlock(voteEnd + 1);
      await E.must_queue(vo, E.secr1, pid);
      await E.wait_eta(vo, pid);
      await E.must_execute(vo, E.secr1, pid);
    }
    else if (state == 'Expired') {
      await setBlock(voteStart);
      await E.must_vote(vo, E.voter1, pid, 'Yes');
      await setBlock(queueDeadline + 1);
    }
    else {
      throw "Unrecognized state " + state;
    }

    // Make sure the state indeed advanced to the desired state.
    await E.check_state(vo, pid, state);
    return pid;
  }

  // Getters

  async check_state(vo, pid, state) {
    if (_.isString(state)) {
      state = this.State[state];
    }
    expect(await vo.state(pid)).to.equal(state);
  }

  async check_getVotes(vo, pid, voterAddr, expectedVotes, expectedGCId) {
    var [ gcId, votes ] = await vo.getVotes(pid, voterAddr);
    expect(votes).to.equal(expectedVotes);
    expect(gcId).to.equal(expectedGCId);
  }

  async check_accessRule(vo, answer) {
    let rule = await vo.accessRule();
    expect(rule[0]).to.equal(answer[0]);
    expect(rule[1]).to.equal(answer[1]);
    expect(rule[2]).to.equal(answer[2]);
    expect(rule[3]).to.equal(answer[3]);
  }

  async check_timingRule(vo, answer) {
    let rule = await vo.timingRule();
    expect(rule[0]).to.equal(answer[0]);
    expect(rule[1]).to.equal(answer[1]);
    expect(rule[2]).to.equal(answer[2]);
    expect(rule[3]).to.equal(answer[3]);
  }

  async wait_voteStart(vo, pid) {
    let schedule = await vo.getProposalSchedule(pid);
    let voteStart = parseInt(schedule[0]);
    await setBlock(voteStart);
  }
  async wait_voteEnd(vo, pid) {
    let schedule = await vo.getProposalSchedule(pid);
    let voteEnd = parseInt(schedule[1]);
    await setBlock(voteEnd);
  }
  async wait_queueDeadline(vo, pid) {
    let schedule = await vo.getProposalSchedule(pid);
    let queueDeadline = parseInt(schedule[2]);
    await setBlock(queueDeadline + 1);
  }
  async wait_eta(vo, pid) {
    let schedule = await vo.getProposalSchedule(pid);
    let eta = parseInt(schedule[3]);
    await setBlock(eta + 1);
  }
  async wait_execDeadline(vo, pid) {
    let schedule = await vo.getProposalSchedule(pid);
    let execDeadline = parseInt(schedule[4]);
    await setBlock(execDeadline + 1);
  }
  async get_totalValue(vo, pid) {
    // Total KLAYs required to successfully execute all actions
    let actions = await vo.getActions(pid);
    return _.reduce(actions[1], addPebs);
  }
}

describe("Voting", function() {
  let E = new VotingTestEnv();

  before(async function() {
    augmentChai();
    await E._createEnv();
  });

  describe("TestEnv", function() {
    it("deploy 50cn", async function() {
      //await E.conf50cn.deployOnce();
    });
  });

  require("./voting_propose.js")(E);
  require("./voting_cast.js")(E);
  require("./voting_execute.js")(E);
  require("./voting_rule.js")(E);
});
