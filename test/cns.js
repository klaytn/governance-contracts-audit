const _ = require("lodash");
const { expect } = require("chai");
const { augmentChai, nowTime, getBalance, toPeb, addPebs, toBytes32 } = require("./helper.js");

const RAND_ADDR = "0xe3B0C44298FC1C149AfBF4C8996fb92427aE41E4"; // non-null placeholder

const FuncID = {
  Unknown: 0,
  AddAdmin: 1,
  DeleteAdmin: 2,
  UpdateRequirement: 3,
  ClearRequest: 4,
  WithdrawLockupStaking: 5,
  ApproveStakingWithdrawal: 6,
  CancelApprovedStakingWithdrawal: 7,
  UpdateRewardAddress: 8,
  UpdateStakingTracker: 9,
  UpdateVoterAddress: 10,
};
const RequestState = {
  Unknown: 0,
  NotConfirmed: 1,
  Executed: 2,
  ExecutionFailed: 3,
  Canceled: 4,
};
const WithdrawlState = {
  Unknown: 0,
  Transferred: 1,
  Canceled: 2,
};

class CnsTestEnv {
  constructor() {
  }

  async _createEnv() {
    this.accounts = await hre.ethers.getSigners();

    this.CnStakingV2 = await ethers.getContractFactory("CnStakingV2Mock");

    let StakingTracker = await ethers.getContractFactory("StakingTrackerMockReceiver");
    this.tracker = await StakingTracker.deploy();

    let ABook = await ethers.getContractFactory("AddressBookMock");
    this.abook = await ABook.deploy();
    await this.abook.constructContract([this.cv.address], 1);

    this.FuncNames = _.filter(_.keys(FuncID), (name) => name != 'Unknown');
    this._sampleArgs = {};
    this._sampleArgs[FuncID.AddAdmin]                        = [this.other1.address];
    this._sampleArgs[FuncID.DeleteAdmin]                     = [this.admin2.address];
    this._sampleArgs[FuncID.UpdateRequirement]               = [3];
    this._sampleArgs[FuncID.ClearRequest]                    = [];
    this._sampleArgs[FuncID.WithdrawLockupStaking]           = [this.other1.address, toPeb(1)];
    this._sampleArgs[FuncID.ApproveStakingWithdrawal]        = [this.other1.address, toPeb(1)];
    this._sampleArgs[FuncID.CancelApprovedStakingWithdrawal] = [0];
    this._sampleArgs[FuncID.UpdateRewardAddress]             = [this.other1.address];
    this._sampleArgs[FuncID.UpdateStakingTracker]            = [this.trackerAddr];
    this._sampleArgs[FuncID.UpdateVoterAddress]              = [this.other2.address];
  }

  // Constants
  get FuncID() { return FuncID; }
  get RequestState() { return RequestState; }
  get WithdrawlState() { return WithdrawlState; }
  sampleArgs(funcName) { return this._sampleArgs[this.FuncID[funcName]] }

  // Sample accounts
  get cv()     { return this.accounts[0]; }
  get admin1() { return this.accounts[1]; }
  get admin2() { return this.accounts[2]; }
  get admin3() { return this.accounts[3]; }
  get other1() { return this.accounts[4]; }
  get other2() { return this.accounts[5]; }
  get nodeId() { return this.accounts[6].address; }
  get rewardAddr() { return this.accounts[7].address; }

  // Sample CnStaking constructor arguments
  get cvAddr() { return this.cv.address; }
  get admins() { return [this.admin1.address, this.admin2.address, this.admin3.address]; }
  get req() { return 2; }
  get amount1() { return toPeb(2e6); }
  get amount2() { return toPeb(4e6); }
  get amounts() { return [this.amount1, this.amount2]; }
  get initDepositAmount() { return addPebs(this.amount1, this.amount2); }
  get trackerAddr() { return this.tracker.address; }

  // Deploy and init

  async parseOpts(opts) {
    let now = await nowTime();
    opts            = opts            || {};
    opts.Factory    = opts.Factory    || this.CnStakingV2;
    opts.sender     = opts.sender     || this.cv;
    opts.cvAddr     = opts.cvAddr     || this.cvAddr;
    opts.nodeId     = opts.nodeId     || this.nodeId;
    opts.rewardAddr = opts.rewardAddr || this.rewardAddr;
    opts.admins     = opts.admins     || this.admins;
    opts.req        = opts.req        || this.req;
    opts.times      = opts.times      || [now+100, now+200];
    opts.amounts    = opts.amounts    || this.amounts;
    // opts.tracker is empty by default
    return opts;
  }

  async deploy(opts) {
    opts = await this.parseOpts(opts);
    return opts.Factory.connect(opts.sender).deploy(
      opts.cvAddr, opts.nodeId, opts.rewardAddr,
      opts.admins, opts.req,
      opts.times, opts.amounts);
  }
  async init(cns, opts) {
    opts = await this.parseOpts(opts);

    if (opts.tracker) {
      await cns.connect(opts.sender).setStakingTracker(opts.tracker);
    }

    await cns.connect(opts.sender).reviewInitialConditions();
    for (var adminAddr of opts.admins) {
      var admin = await ethers.getSigner(adminAddr);
      await cns.connect(admin).reviewInitialConditions();
    }

    let totalAmount = _.reduce(opts.amounts, addPebs);
    await cns.connect(opts.sender).depositLockupStakingAndInit({
      value: totalAmount });

    return cns;
  }
  async deployInit(opts) {
    let cns = await this.deploy(opts);
    await this.init(cns, opts);
    return cns;
  }

  // Initialization functions

  async must_setStakingTracker(cns, sender, trackerAddr) {
    await expect(cns.connect(sender).setStakingTracker(trackerAddr))
      .to.emit(cns, "UpdateStakingTracker").withArgs(trackerAddr);

    expect(await cns.stakingTracker()).to.equal(trackerAddr);
  }
  async revert_setStakingTracker(cns, sender, trackerAddr, msg) {
    await expect(cns.connect(sender).setStakingTracker(trackerAddr))
      .to.be.revertedWith(msg);
  }

  async must_reviewInitialConditions(cns, sender, isLast) {
    let e = expect(cns.connect(sender).reviewInitialConditions())
      .to.emit(cns, "ReviewInitialConditions").withArgs(sender.address);
    if (isLast) {
      e.to.emit(cns, "CompleteReviewInitialConditions");
    }
    await e;
  }
  async revert_reviewInitialConditions(cns, sender, msg) {
    await expect(cns.connect(sender).reviewInitialConditions())
      .to.be.revertedWith(msg);
  }

  async must_depositLockupStakingAndInit(cns, sender, amount) {
    await expect(cns.connect(sender).depositLockupStakingAndInit({ value: amount }))
      .to.emit(cns, "DepositLockupStakingAndInit").withArgs(sender.address, amount);
  }
  async revert_depositLockupStakingAndInit(cns, sender, amount, msg) {
    await expect(cns.connect(sender).depositLockupStakingAndInit({ value: amount }))
      .to.be.revertedWith(msg);
  }

  // Multisig functions, with fixed arguments.
  // These functions are for testing the multisig logic, not the admin management feature.

  tx_submit(cns, sender, funcName, args) {
    return cns.connect(sender)["submit" + funcName](...args);
  }
  tx_confirm(cns, sender, id, func, args) {
    if (_.isString(func)) {
      func = this.FuncID[func];
    }
    var a1 = toBytes32(args[0] || 0);
    var a2 = toBytes32(args[1] || 0);
    var a3 = toBytes32(args[2] || 0);
    return cns.connect(sender).confirmRequest(id, func, a1, a2, a3);
  }
  tx_revoke(cns, sender, id, func, args) {
    if (_.isString(func)) {
      func = this.FuncID[func];
    }
    var a1 = toBytes32(args[0] || 0);
    var a2 = toBytes32(args[1] || 0);
    var a3 = toBytes32(args[2] || 0);
    return cns.connect(sender).revokeConfirmation(id, func, a1, a2, a3);
  }

  async must_submitAddAdmin(cns, sender, eventKinds, confirmers) {
    let args = this.sampleArgs('AddAdmin');
    let e = expect(cns.connect(sender).submitAddAdmin(...args));
    await this.check_funcEvents(e, cns, sender, 0, 'AddAdmin', args, eventKinds, confirmers);
  }
  async revert_submitAddAdmin(cns, sender, msg) {
    let args = this.sampleArgs('AddAdmin');
    await expect(cns.connect(sender).submitAddAdmin(...args)).to.be.revertedWith(msg);
  }

  async must_confirmAddAdmin(cns, sender, eventKinds, confirmers) {
    let args = this.sampleArgs('AddAdmin');
    let e = expect(this.tx_confirm(cns, sender, 0, 'AddAdmin', args));
    await this.check_funcEvents(e, cns, sender, 0, 'AddAdmin', args, eventKinds, confirmers);
  }
  async revert_confirmAddAdmin(cns, sender, msg) {
    let args = this.sampleArgs('AddAdmin');
    await expect(this.tx_confirm(cns, sender, 0, 'AddAdmin', args)).to.be.revertedWith(msg);
  }

  async must_revokeAddAdmin(cns, sender, eventKinds, confirmers) {
    let args = this.sampleArgs('AddAdmin');
    let e = expect(this.tx_revoke(cns, sender, 0, 'AddAdmin', args));
    await this.check_funcEvents(e, cns, sender, 0, 'AddAdmin', args, eventKinds, confirmers);
  }
  async revert_revokeAddAdmin(cns, sender, msg) {
    let args = this.sampleArgs('AddAdmin');
    await expect(this.tx_revoke(cns, sender, 0, 'AddAdmin', args)).to.be.revertedWith(msg);
  }

  // Multisig functions, arbitrary arguments.
  // These functions are for testing the various features of CnStaking contract.
  // must_func() assumes that requirement is 1 for simplicity.

  async must_func(cns, sender, funcName, callArgs, eventArgs) {
    let id = await cns.requestCount();

    let e = expect(this.tx_submit(cns, sender, funcName, callArgs));
    // Attach assertions for multisig events
    e = this.check_funcEvents(e, cns, sender, id, funcName, callArgs,
                              'submit,confirm,success', [sender]);
    // Attach an assertion for the executed function
    e = e.to.emit(cns, funcName);
    if (eventArgs) {
      e = e.withArgs(...eventArgs);
    }
    await e;
  }
  async revert_func(cns, sender, funcName, callArgs, msg) {
    await expect(this.tx_submit(cns, sender, funcName, callArgs)).to.be.revertedWith(msg);
  }

  // kinds: a comma-separated string of event kinds (see below if-statements)
  // id: request id
  // func: func id
  // args: func args
  // confirmers: expected list of confirmers appearing in the event log
  check_funcEvents(e, cns, sender, id, func, args, eventKinds, confirmers) {
    sender = sender.address || sender;
    if (_.isString(func)) {
      func = this.FuncID[func];
    }
    var a1 = toBytes32(args[0] || 0);
    var a2 = toBytes32(args[1] || 0);
    var a3 = toBytes32(args[2] || 0);
    eventKinds = eventKinds || "";
    confirmers = _.map((confirmers || []), (elem) => (elem.address || elem));

    for (var kind of eventKinds.split(',')) {
      if (kind == "submit") {
        e = e.to.emit(cns, "SubmitRequest").withArgs(id, sender, func, a1, a2, a3);
      }
      if (kind == "confirm") {
        e = e.to.emit(cns, "ConfirmRequest").withArgs(id, sender, func, a1, a2, a3, confirmers);
      }
      if (kind == "revoke") {
        e = e.to.emit(cns, "RevokeConfirmation").withArgs(id, sender, func, a1, a2, a3, confirmers);
      }
      if (kind == "cancel") {
        e = e.to.emit(cns, "CancelRequest").withArgs(id, sender, func, a1, a2, a3);
      }
      if (kind == "success") {
        e = e.to.emit(cns, "ExecuteRequestSuccess").withArgs(id, sender, func, a1, a2, a3);
      }
      if (kind == "failure") {
        e = e.to.emit(cns, "ExecuteRequestFailure").withArgs(id, sender, func, a1, a2, a3);
      }
    }
    return e;
  }

  // Getter enhancements

  async check_RequestState(cns, id, state) {
    if (_.isString(state)) {
      state = this.RequestState[state];
    }
    let info = await cns.getRequestInfo(id);
    expect(info[6]).to.equal(state);
  }

  async check_WithdrawalState(cns, id, state) {
    if (_.isString(state)) {
      state = this.WithdrawlState[state];
    }
    let info = await cns.getApprovedStakingWithdrawalInfo(id);
    expect(info[3]).to.equal(state);
  }

  async query_stakes(cns, other) {
    return {
      initial:      await cns.initialLockupStaking(),
      remain:       await cns.remainingLockupStaking(),
      withdrawable: (await cns.getLockupStakingInfo())[4],
      staking:      await cns.staking(),
      unstaking:    cns.unstaking ? await cns.unstaking() : null,
      balCns:       await getBalance(cns.address),
      balOther:     await getBalance(other.address || other),
    };
  }

  async query_fromTime(cns, id) {
    // query withdrawableFrom time
    let info = await cns.getApprovedStakingWithdrawalInfo(id);
    return parseInt(info[2]);
  }

  async calc_fromTime(cns) {
    // calc expected withdrawableFrom time
    return parseInt(await nowTime()) + parseInt(await cns.STAKE_LOCKUP()) + 1;
  }
};

describe("CnStakingV2", function() {
  let E = new CnsTestEnv();

  before(async function() {
    augmentChai();
    await E._createEnv();
  });

  require("./cns_init.js")(E);
  require("./cns_multisig.js")(E);
  require("./cns_admin.js")(E);
  require("./cns_lockup.js")(E);
  require("./cns_nonlockup.js")(E);
  require("./cns_link.js")(E);
});
