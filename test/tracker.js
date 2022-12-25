const _ = require("lodash");
const { expect } = require("chai");
const { constants } = require("@openzeppelin/test-helpers");
const { augmentChai, nowBlock, nowTime, setBlock, setTime, getBalance,
        toPeb, toKlay, addPebs, subPebs, toBytes32, arrToObj, numericAddr } = require("./helper.js");
const { StakingContract, StakingConf, buildUniformCnOpts, build50x2cnOpts } = require("./helper_conf.js");

const NULL_ADDR = constants.ZERO_ADDRESS;
const NA = numericAddr;

class StakingTrackerTestEnv {
  constructor() {
  }

  async _createEnv() {
    this.accounts = await hre.ethers.getSigners();

    this.AddressBook = await ethers.getContractFactory("AddressBookMock");
    this.CnStakingV1 = await ethers.getContractFactory("CnStakingContract");
    this.CnStakingV2 = await ethers.getContractFactory("CnStakingV2Mock");
    this.StakingTracker = await ethers.getContractFactory("StakingTrackerMock");

    this.conf1cn = this.createConf({ balances: [
      [5e6]
    ]});
    this.conf5cn = this.createConf({ balances: [
      [20e6],      // 20m  -> 4 votes, but capped to 3 votes.
      [3e6, 7e6],  // 10m  -> 2 votes
      [0, 1, 5e6], // 5m+1 -> 1 vote
      [2e6, 3e6],  // 5m   -> 1 vote
      [4e6],       // 4m+1 -> 0 votes
    ]});
    this.conf50cn = this.createConf(buildUniformCnOpts(50));
    this.conf50x2cn = this.createConf(build50x2cnOpts());
    this.conf100cn = this.createConf(buildUniformCnOpts(100));

    await this.conf1cn.deployOnce();
  }

  // Sample accounts
  get deployer() { return this.accounts[0]; }
  get admin1()   { return this.accounts[1]; }
  get voter1()   { return this.accounts[2]; }
  get voter2()   { return this.accounts[3]; }
  get other1()   { return this.accounts[4]; }

  // staking configurations
  createConf(opts, envs) {
    envs = envs || {};
    envs.AddressBook = envs.AddressBook || this.AddressBook;
    envs.CnStaking   = envs.CnStaking   || this.CnStakingV2;
    envs.deployer    = envs.deployer    || this.deployer;
    envs.admin       = envs.admin       || this.admin1;
    return new StakingConf(opts, envs)
  };

  async createCnStaking(CnStaking, nodeId, rewardAddr, balance) {
    let envs = {
      AddressBook: this.AddressBook,
      CnStaking: CnStaking, // custom CnStaking contract
      deployer: this.deployer,
      admin: this.admin1,
    };
    let cns = new StakingContract(envs, nodeId, rewardAddr, balance);
    await cns.init();
    await setTime((await nowTime()) + 10000);
    await cns.setBalance();
    return cns;
  }

  async createAbook(nodeIds, cnsAddrsList, rewardAddrs) {
    let abook = await this.AddressBook.deploy();
    await abook.constructContract([], 0);
    await abook.mockRegisterCnStakingContracts(nodeIds, cnsAddrsList, rewardAddrs);
    return abook;
  }

  // Deploy

  async deploy(conf) {
    var abookAddr = this.conf1cn.abookAddr;
    if (conf) {
      abookAddr = conf.abookAddr;
    }

    let st = await this.StakingTracker.connect(this.deployer).deploy();
    await st.mockSetAddressBookAddress(abookAddr);
    return st;
  }

  async deploy_get_cns0(conf, setTracker = true) {
    await conf.deploy();

    let st = await this.deploy({ abookAddr: conf.abookAddr });

    let cns0;
    if (setTracker) {
      cns0 = await this.get_cns(conf, 0, 0, st);
    } else {
      cns0 = await this.get_cns(conf, 0, 0);
    }
    return { st, cns0 };
  }

  async get_cns(conf, nodeIdx, stakingIdx, st) {
    let cnsAddr = conf.cnsAddrs[nodeIdx][stakingIdx];
    let cns = await this.CnStakingV2.attach(cnsAddr);
    if (st) {
      await expect(cns.connect(this.admin1).submitUpdateStakingTracker(st.address))
        .to.emit(cns, "UpdateStakingTracker").withArgs(st.address);
    }
    return cns;
  }

  // Create

  async tx_create(st, sender, duration) {
    sender   = sender   || this.deployer;
    duration = duration || 60;
    let ts = await nowBlock();
    let te = ts + duration;

    return st.connect(sender).createTracker(ts, te);
  }
  async must_create(st, sender, duration) {
    sender   = sender   || this.deployer;
    duration = duration || 60;
    let ts = await nowBlock();
    let te = ts + duration;

    await expect(st.connect(sender).createTracker(ts, te))
      .to.emit(st, "CreateTracker");

    let tid = await st.getLastTrackerId();
    return { tid, ts, te };
  }
  async must_create_a(st, sender, duration) {
    // same as must_create(), but returns an array instead of object.
    let { tid, ts, te } = await this.must_create(st, sender, duration);
    return [ tid, ts, te ];
  }

  // Getters

  async check_allIds(st, ids) {
    expect(await st.getAllTrackerIds()) .to.equalNumberList(ids);
  }
  async check_liveIds(st, ids) {
    expect(await st.getLiveTrackerIds()) .to.equalNumberList(ids);
  }

  async check_tracker(st, tid, conf, ts, te) {
    let opts = conf.opts;
    let summary = await st.getTrackerSummary(tid);
    if (ts) expect(summary[0]).to.equal(ts);
    if (te) expect(summary[1]).to.equal(te);
    expect(summary[2]).to.equal(opts.numNodes);
    expect(summary[3]).to.equal(opts.totalVotes);
    expect(summary[4]).to.equal(opts.eligibleNodes);

    let allNodes = await st.getAllTrackedNodes(tid);
    expect(allNodes[0]).to.equalAddrList(opts.nodeIds);
    expect(allNodes[1]).to.equalNumberList(_.map(opts.nodeBalances, toPeb));
    expect(allNodes[2]).to.equalNumberList(opts.nodeVotes);

    for (var i = 0; i < opts.nodeIds.length; i++) {
      let nodeInfo = await st.getTrackedNode(tid, opts.nodeIds[i]);
      expect(nodeInfo[0]).to.equal(toPeb(opts.nodeBalances[i]));
      expect(nodeInfo[1]).to.equal(opts.nodeVotes[i]);
    }
  }

  async check_voter_mapped(st, nodeId, voter) {
    expect(await st.nodeIdToVoter(nodeId)).to.equal(voter);
    expect(await st.voterToNodeId(voter)).to.equal(nodeId);
  }
  async check_voter_null(st, nodeId, voter) {
    expect(await st.nodeIdToVoter(nodeId)).to.equal(NULL_ADDR);
    expect(await st.voterToNodeId(voter)).to.equal(NULL_ADDR);
  }
}

describe("StakingTracker", function() {
  let E = new StakingTrackerTestEnv();

  before(async function() {
    augmentChai();
    await E._createEnv();
  });

  describe("TestEnv", function() {
    it("conf auto-calc", function() {
      var answer = {
        balances: [
          [20e6],      // 20m  -> 4 votes, but capped to 3 votes.
          [3e6, 7e6],  // 10m  -> 2 votes
          [0, 1, 5e6], // 5m+1 -> 1 vote
          [2e6, 3e6],  // 5m   -> 1 vote
          [4e6],       // 4m+1 -> 0 votes
        ],
        nodeIds: [ NA(0,1), NA(1,1), NA(2,1), NA(3,1), NA(4,1) ],
        nodeBalances: [ 20e6, 10e6, 5e6+1, 5e6, 4e6 ],
        nodeVotes: [ 3, 2, 1, 1, 0 ],
        numNodes: 5, totalVotes: 7, eligibleNodes: 4,
      };
      var conf = E.createConf({ balances: answer.balances });
      expect(conf.opts).to.deep.equal(answer);
    });
    it("deploy 1cn", async function() {
      await E.conf1cn.deployOnce();
    });
    it("deploy 5cn", async function() {
      await E.conf5cn.deployOnce();
    });
    it("deploy 50cn", async function() {
      await E.conf50cn.deployOnce();
    });
    it("deploy 50x2cn", async function() {
      await E.conf50x2cn.deployOnce();
    });
    it("deploy 100cn", async function() {
      await E.conf100cn.deployOnce();
    });
  });

  require("./tracker_create.js")(E);
  require("./tracker_stake.js")(E);
  require("./tracker_voter.js")(E);
});
