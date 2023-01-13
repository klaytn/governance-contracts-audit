const _ = require("lodash");
const { expect } = require("chai");
const { constants } = require("@openzeppelin/test-helpers");
const { augmentChai, nowTime, setTime, nowBlock, setBlock, getBalance,
        toPeb, addPebs, numericAddr, expectRevert } = require("./helper.js");

class ScenarioTestEnv {
  constructor() {
  }

  async _createEnv() {
    this.accounts = await hre.ethers.getSigners();

    this.ABook = await ethers.getContractFactory("AddressBookMock");
    this.CnSV1 = await ethers.getContractFactory("CnStakingContract");
    this.CnSV2 = await ethers.getContractFactory("CnStakingV2");
    this.ST = await ethers.getContractFactory("StakingTracker");
    this.STMock = await ethers.getContractFactory("StakingTrackerMock");
    this.Vo = await ethers.getContractFactory("Voting");
    this.GP = await ethers.getContractFactory("GovParam");
  }

  get deployer() { return this.accounts[0]; }
  get secr1()    { return this.accounts[1]; }
  get secr2()    { return this.accounts[2]; }
  get admin1()   { return this.accounts[3]; }
  get admin2()   { return this.accounts[4]; }
  get admin3()   { return this.accounts[5]; }
  get voter1()   { return this.accounts[6]; }
  get voter2()   { return this.accounts[7]; }
  get voter3()   { return this.accounts[8]; }
  get voter4()   { return this.accounts[9]; }

  async cnsDeployV1(nodeId, rewardAddr) {
    let t1 = (await nowTime()) + 10;
    let cns = await this.CnSV1.connect(this.deployer).deploy(
      this.deployer.address, nodeId, rewardAddr,
      [this.admin1.address], 1, [t1], [toPeb(1)]);

    await cns.connect(this.deployer).reviewInitialConditions();
    await cns.connect(this.admin1).reviewInitialConditions();
    await cns.connect(this.admin1).depositLockupStakingAndInit({
      value: toPeb(1) });
    return cns;
  }
  async cnsDeployV2(nodeId, rewardAddr, stAddr) {
    let t1 = (await nowTime()) + 10;
    let cns = await this.CnSV2.connect(this.deployer).deploy(
      this.deployer.address, nodeId, rewardAddr,
      [this.admin1.address], 1, [t1], [toPeb(1)]);

    await cns.setStakingTracker(stAddr);
    await cns.connect(this.deployer).reviewInitialConditions();
    await cns.connect(this.admin1).reviewInitialConditions();
    await cns.connect(this.admin1).depositLockupStakingAndInit({
      value: toPeb(1) });
    return cns;
  }
  async cnsSetST(cns, stAddr) {
    await cns.connect(this.deployer).setStakingTracker(stAddr);
  }
  async cnsStake(cns, amt) {
    await cns.connect(this.deployer).stakeKlay({ value: amt });
  }
  async cnsApprove(cns, out, amt) {
    let wid = await cns.withdrawalRequestCount();
    await cns.connect(this.admin1).submitApproveStakingWithdrawal(out, amt);
    return wid;
  }
  async cnsWithdraw(cns, wid) {
    let wInfo = await cns.getApprovedStakingWithdrawalInfo(wid);
    await setTime(parseInt(wInfo[2]));
    await cns.connect(this.admin1).withdrawApprovedStaking(wid);
  }
  async cnsUpdateStakingTracker(cns, stAddr) {
    await cns.connect(this.admin1).submitUpdateStakingTracker(stAddr);
  }
  async cnsUpdateVoter(cns, voterAddr) {
    await cns.connect(this.admin1).submitUpdateVoterAddress(voterAddr);
  }

  async singletonDeploy() {
    let E = this;

    let abook = await E.ABook.deploy();
    await abook.constructContract([], 0);

    let st = await E.STMock.connect(E.deployer).deploy();
    await st.mockSetAddressBookAddress(abook.address);
    let gp = await E.GP.connect(E.deployer).deploy();

    let vo = await E.Vo.connect(E.deployer).deploy(st.address, E.secr1.address);
    await st.connect(E.deployer).transferOwnership(vo.address);
    await gp.connect(E.deployer).transferOwnership(vo.address);

    return [ abook, st, vo, gp ];
  }

  async queueProposal(vo, voter, secr, pid) {
    var { voteStart, voteEnd } = await vo.getProposalSchedule(pid);

    await setBlock(voteStart);
    await vo.connect(voter).castVote(pid, 1); // Yes=1

    await setBlock(voteEnd);
    await vo.connect(secr).queue(pid);

    let { eta } = await vo.getProposalSchedule(pid);
    await setBlock(eta);
  }

  async voteSetParam(vo, voter, secr, gp) {
    // Pass a GovParam.setParam proposal to demonstrate that
    // the voting contract works.
    // For simplicity, assume the vote from 'voter' is sufficient to pass a proposal.

    // Create calldata
    let activation = (await nowBlock()) + 604800;
    let tx = await gp.populateTransaction.setParam(
      "istanbul.committeesize", true, "0x20", activation);
    let calldata = tx.data;

    await vo.connect(secr).propose("Update param",
      [gp.address],
      [toPeb(0)],
      [calldata],
      86400, 86400);

    var pid = await vo.lastProposalId();
    await this.queueProposal(vo, voter, secr, pid);

    await expect(vo.connect(secr).execute(pid))
      .to.emit(vo, "ProposalExecuted")
      .to.emit(gp, "SetParam").withArgs("istanbul.committeesize", true, "0x20", activation);

    var [ names, values ] = await gp.getAllParams();
    expect(names.length).to.equal(0);

    await setBlock(activation);

    var [ names, values ] = await gp.getAllParams();
    expect(names[0]).to.equal("istanbul.committeesize");
    expect(values[0]).to.equal("0x20");
  }
}

describe("Operation scenarios", function() {
  let E = new ScenarioTestEnv();

  before(async function() {
    augmentChai();
    await E._createEnv();
  });

  require("./scenario_usage.js")(E);
  require("./scenario_replace.js")(E);
});
