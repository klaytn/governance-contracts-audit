const { constants } = require("@openzeppelin/test-helpers");
const { expect } = require("chai");
const _ = require("lodash");
const { augmentChai, nowBlock, nowTime, setBlock, setTime, getBalance,
        toPeb, toKlay, addPebs, subPebs, toBytes32, arrToObj, numericAddr } = require("./helper.js");

const NULL_ADDR = constants.ZERO_ADDRESS;
// Address rules:
// Representative Node IDs: NA(n,1)
// Placeholder Node IDs: NA(n,2..8)
// Reward Addrs: NA(n,9)
// GC IDs: 700+n
const NA = numericAddr;
const [ NA01, NA11, NA21, NA31, NA41 ] = [ NA(0,1), NA(1,1), NA(2,1), NA(3,1), NA(4,1) ];
const [ NA02, NA03, NA12, NA13, NA32 ] = [ NA(0,2), NA(0,3), NA(1,2), NA(1,3), NA(3,2) ];
const [ NA09, NA19, NA29, NA39, NA49 ] = [ NA(0,9), NA(1,9), NA(2,9), NA(3,9), NA(4,9) ];

function calc_votes(nodeBalance, numEligible) {
  var cap = _.max([1, numEligible - 1]);
  return _.min([_.floor(nodeBalance / 5e6), cap]);
}
function calc_numEligible(nodeBalances) {
  return _.filter(nodeBalances, (b) => b >= 5e6).length;
}
function calc_allVotes(nodeBalances) {
  numEligible = calc_numEligible(nodeBalances);
  return _.map(nodeBalances, (b) => calc_votes(b, numEligible));
}

class StakingContract {
  constructor(envs, nodeId, rewardAddr, gcId, balance) {
    this.envs = envs;
    this.nodeId = nodeId;
    this.rewardAddr = rewardAddr;
    this.gcId = gcId;
    this.balance = balance;
    this.address = null;
  }

  async init() {
    let deployer = this.envs.deployer;
    let admin = this.envs.admin;
    let nodeId = this.nodeId;
    let rewardAddr = this.rewardAddr;

    let now = await nowTime();
    let t1 = now + 10000;
    let cns = await this.envs.CnStaking.connect(deployer).deploy(
      deployer.address, this.nodeId, this.rewardAddr,
      [admin.address], 1,
      [t1], [toPeb(1)]);
    if (parseInt(await cns.VERSION()) >= 2) {
      await cns.connect(deployer).setGCId(this.gcId);
    }
    await cns.connect(deployer).reviewInitialConditions();
    await cns.connect(admin).reviewInitialConditions();
    await cns.connect(deployer).depositLockupStakingAndInit({ value: toPeb(1) });
    this.cns = cns;
    this.address = cns.address;
  }

  async setBalance() {
    let deployer = this.envs.deployer;
    let admin = this.envs.admin;
    let balance = this.balance;

    if (balance == toPeb(0)) {
      await this.cns.connect(admin).submitWithdrawLockupStaking(deployer.address, toPeb(1));
    } else if (balance == toPeb(1)) {
      // do nothing
    } else {
      let diff = toPeb(toKlay(balance) - 1);
      await this.cns.connect(deployer).stakeKlay({ value: diff });
    }
    if (0) console.log('cns(n,s,r,b)=', this.nodeId, this.cns.address, this.rewardAddr, toKlay(this.balance));
  }
}

class StakingConf {
  // opts: contract configurations
  // envs: things used when deploying contracts
  constructor(opts, envs) {
    // balances is an array-of-arrays where each array represents
    // the staking balances of a CN.
    //
    // For missing fields, calculate from opts.balances.
    opts = opts || {};

    opts.balances    =  opts.balances    || [ [5e6] ];
    opts.numGCs      =  opts.numGCs      || opts.balances.length;
    opts.gcIds       =  opts.gcIds       || _.map(_.range(opts.numGCs), (n) => 700+n);
    opts.gcBalances  =  opts.gcBalances  || _.map(opts.balances, _.sum);
    opts.numEligible =  opts.numEligible || calc_numEligible(opts.gcBalances);
    opts.gcVotes     =  opts.gcVotes     || calc_allVotes(opts.gcBalances);
    opts.totalVotes  =  opts.totalVotes  || _.sum(opts.gcVotes);

    this.opts = opts;
    this.envs = envs;
    this._cnsAddrs = null;
    this._cnsAddrsList = null;
    this._abookAddr = null;
  }

  get cnsAddrs() { return this._cnsAddrs; }
  get cnsAddrsList() { return this._cnsAddrsList; }
  get abookAddr() { return this._abookAddr; }
  get deployed() { return this._abookAddr != null; }

  async deployOnce() {
    if (!this.deployed) {
      await this.deploy();
    }
  }
  async deploy() {
    await this.deployCnsAbook();
  }
  async deployCnsAbook() {
    let { nodeIds, cnsAddrsList, rewardAddrs } = await this.initStakingBatch();
    this._cnsAddrsList = cnsAddrsList;
    this._abookAddr = await this.initABook(nodeIds, cnsAddrsList, rewardAddrs);
    this._cnsAddrs = this.reorganizeContracts(cnsAddrsList);
    if (0) console.log('Deploy(#nodes, #cns, abook)=',
      this._cnsAddrs.length, this._cnsAddrsList.length, this._abookAddr);
  }

  async initStakingBatch() {
    // Assign nodeIds and rewardAddrs to each staking contracts
    let nodeIds = [];
    let rewardAddrs = [];
    let cnsList = [];
    let balances = this.opts.balances;
    for (var i = 0; i < balances.length; i++) {
      for (var j = 0; j < balances[i].length; j++) {
        let gcId       = 700+i;
        let nodeId     = NA(i, j+1);
        let rewardAddr = NA(i, 9);
        let balance    = toPeb(balances[i][j]);
        let contract   = new StakingContract(this.envs, nodeId, rewardAddr, gcId, balance);

        nodeIds.push(nodeId);
        rewardAddrs.push(rewardAddr);
        cnsList.push(contract);
      }
    }

    // Deploy all contracts in parallel
    await Promise.all(_.map(cnsList, (cns) => cns.init()));
    await setTime((await nowTime()) + 10000);
    await Promise.all(_.map(cnsList, (cns) => cns.setBalance()));
    let cnsAddrsList = _.map(cnsList, (cns) => cns.address);
    this.cnsList = cnsList;

    return { nodeIds, cnsAddrsList, rewardAddrs };
  }

  async initABook(nodeIds, cnsAddrsList, rewardAddrs) {
    let abook = await this.envs.AddressBook.deploy();
    await abook.constructContract([], 0);

    // Register at most 20 entries per tx, because otherwise may out-of-gas.
    var nChunks = _.chunk(nodeIds, 20);
    var sChunks = _.chunk(cnsAddrsList, 20);
    var rChunks = _.chunk(rewardAddrs, 20);
    for (var i = 0; i < nChunks.length; i++) {
      await abook.mockRegisterCnStakingContracts(
        nChunks[i], sChunks[i], rChunks[i]);
    }
    return abook.address;
  }

  reorganizeContracts(cnsAddrsList) {
    // Reorganize staking contracts in an array-of-arrays
    let cnsAddrs = [];
    let k = 0;
    let balances = this.opts.balances;
    for (var i = 0; i < balances.length; i++) {
      cnsAddrs[i] = [];
      for (var j = 0; j < balances[i].length; j++) {
        cnsAddrs[i][j] = cnsAddrsList[k++];
      }
    }
    return cnsAddrs;
  }
}

function buildUniformCnOpts(numCNs) {
  // A uniform case of total N CNs, each having 5m (1 vote).
  N = numCNs;
  conf = {
    balances: repeat(N, [5e6]),
    nodeIds: _.map(_.range(N), (n) => NA(n,1)),
    nodeBalances: repeat(N, 5e6),
    nodeVotes: repeat(N, 1),
    numNodes: N,
    totalVotes: N,
    numEligible: N,
  };
  return conf;
}
function build50x2cnOpts() {
  // A hypothetical case of
  // Total 50 CNs, total 100 CnStaking contracts where:
  //   5  CNs with 500m (100 votes uncapped; 39 capped)
  //   5  CNs with 50m  (10 votes)
  //   30 CNs with 5m   (1 vote)
  //   10 CNs with 0    (ineligible)
  conf = {};
  conf.balances = _.concat(
    repeat(5,  [0, 500e6]),
    repeat(5,  [0, 50e6]),
    repeat(30, [0, 5e6]),
    repeat(10, [0, 1]),
  );
  conf.nodeIds = _.map(_.range(50), (n) => NA(n,1));
  conf.nodeBalances = _.concat(
    repeat(5,  500e6),
    repeat(5,  50e6),
    repeat(30, 5e6),
    repeat(10, 1),
  );
  conf.nodeVotes = _.concat(
    repeat(5,  39),
    repeat(5,  10),
    repeat(30, 1),
    repeat(10, 0),
  );
  conf.numNodes = 50;
  conf.totalVotes = _.sum(conf.nodeVotes);
  conf.numEligible = 40;
  return conf;
}
function repeat(count, item) {
  return _.fill(Array(count), item);
}

module.exports = {
  StakingContract,
  StakingConf,
  buildUniformCnOpts,
  build50x2cnOpts
};
