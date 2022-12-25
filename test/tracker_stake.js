const _ = require("lodash");
const { expect } = require("chai");
const { constants } = require("@openzeppelin/test-helpers");
const { nowTime, setTime, nowBlock, setBlock, getBalance,
        toKlay, toPeb, expectRevert, numericAddr } = require("./helper.js");

const NULL_ADDR = constants.ZERO_ADDRESS;
const RAND_ADDR = "0xe3B0C44298FC1C149AfBF4C8996fb92427aE41E4"; // non-null placeholder

const NA = numericAddr;
const [ NA01, NA11, NA21, NA31, NA41 ] = [ NA(0,1), NA(1,1), NA(2,1), NA(3,1), NA(4,1) ];
const [ NA02, NA03, NA12, NA13, NA32 ] = [ NA(0,2), NA(0,3), NA(1,2), NA(1,3), NA(3,2) ];
const [ NA09, NA19, NA29, NA39, NA49 ] = [ NA(0,9), NA(1,9), NA(2,9), NA(3,9), NA(4,9) ];

module.exports = function(E) {

  describe("refreshStake", function() {

    let conf111, conf211;
    let conf222, conf122, conf022;
    before(function() {
      // confs starting from (1,1,1)
      conf111 = E.createConf({
        balances:     [ [5e6], [5e6], [5e6] ],
        nodeVotes:    [ 1,     1,     1     ],
        numNodes: 3, totalVotes: 3, eligibleNodes: 3,
      });
      conf211 = E.createConf({
        balances:     [ [10e6], [5e6], [5e6] ],
        nodeVotes:    [ 2,      1,     1     ],
        numNodes: 3, totalVotes: 4, eligibleNodes: 3,
      });
      // configs starting from (2,2,2)
      conf222 = E.createConf({
        balances:     [ [10e6], [10e6], [10e6] ],
        nodeVotes:    [ 2,      2,      2      ],
        numNodes: 3, totalVotes: 6, eligibleNodes: 3,
      });
      conf122 = E.createConf({
        balances:     [ [5e6], [10e6], [10e6] ],
        nodeVotes:    [ 1,     2,      2      ],
        numNodes: 3, totalVotes: 5, eligibleNodes: 3,
      });
      conf022 = E.createConf({
        // This conf describes a situation where CN0 is eligible with 0 votes.
        // This situation can be created when CN0 had nonzero votes at createTracker,
        // and then withdraw (or approve withdrawal) most amounts.
        // CN0 falling below minstake does not affect the vote cap of 2 votes.
        balances:     [ [1e6], [10e6], [10e6] ],
        nodeVotes:    [ 0,     2,      2      ],
        numNodes: 3, totalVotes: 4, eligibleNodes: 3,
      });
    });

    async function deploy_create(conf) {
      let { st, cns0 } = await E.deploy_get_cns0(conf);
      let { tid, ts, te } = await E.must_create(st);
      await E.check_tracker(st, tid, conf, ts, te);
      return { st, tid, ts, te, cns0 };
    }

    function tx_withdrawLockup(cns, amt) {
      return cns.connect(E.admin1).submitWithdrawLockupStaking(E.other1.address, amt);
    }
    function tx_stake(cns, amt) {
      return cns.connect(E.admin1).stakeKlay({ value: amt });
    }
    function tx_approve(cns, amt) {
      return cns.connect(E.admin1).submitApproveStakingWithdrawal(E.other1.address, amt);
    }
    function tx_cancel(cns) {
      return cns.connect(E.admin1).submitCancelApprovedStakingWithdrawal(0);
    }
    function tx_withdraw(cns) {
      return cns.connect(E.admin1).withdrawApprovedStaking(0);
    }
    async function waitWithdrawFrom(cns) {
      await setTime((await nowTime()) + parseInt(await cns.STAKE_LOCKUP()) + 1);
    }
    async function waitWithdrawUntil(cns) {
      await setTime((await nowTime()) + parseInt(await cns.STAKE_LOCKUP()) * 2 + 1);
    }

    describe("trigger by CnStaking", function() {

      // Check that given 'tx' calls st.refreshStake()
      // and that the resulting Tracker state is equal to 'postconf'.
      async function check_refresh(st, tid, cns, tx, postConf) {
        let opts = postConf.opts; // expected configuration after refreshStake

        await expect(tx)
          .to.emit(st, "RefreshStake").withArgs(
            tid,                         // tid
            NA01,                        // nodeId
            cns.address,                 // staking
            toPeb(opts.balances[0][0]),  // stakingBalance
            toPeb(opts.nodeBalances[0]), // nodeBalance
            opts.nodeVotes[0],           // nodeVotes
            opts.totalVotes,             // totalVotes
          );

        await E.check_tracker(st, tid, postConf);
      }

      // Touch every safeRefreshStake call sites in CnStakingV2:
      // - withdrawLockupStaking
      // - approveStakingWithdrawal
      // - cancelApprovedStakingWithdrawal
      // - stakeKlay
      // - withdrawApprovedStaking (Canceled)
      // - withdrawApprovedStaking (Transferred)

      it("withdraw initial lockup", async function() {
        // Note: StakingContract.setBalance() won't drain initial lockup if desired balance is 1.
        // Thanks to that behavior we can test WithdrawLockup with 1 KLAY here.
        let conf1 = E.createConf({ balances: [ [1] ] });
        let conf0 = E.createConf({ balances: [ [0] ] });

        let { st, tid, cns0 } = await deploy_create(conf1);
        await check_refresh(st, tid, cns0, tx_withdrawLockup(cns0, toPeb(1)), conf0);
      });
      it("stake non-lockup", async function() {
        let { st, tid, cns0 } = await deploy_create(conf111);
        await check_refresh(st, tid, cns0, tx_stake(cns0, toPeb(5e6)), conf211);
      });
      it("withdraw non-lockup stay above minstake", async function() {
        let { st, tid, cns0 } = await deploy_create(conf222);
        // votes already decrease after approval
        await check_refresh(st, tid, cns0, tx_approve(cns0, toPeb(5e6)), conf122);
        // votes unchanged by actual withdrawal
        await waitWithdrawFrom(cns0);
        await check_refresh(st, tid, cns0, tx_withdraw(cns0), conf122);
      });
      it("withdraw non-lockup fall below minstake", async function() {
        let { st, tid, cns0 } = await deploy_create(conf222);
        // votes already decrease after approval
        await check_refresh(st, tid, cns0, tx_approve(cns0, toPeb(9e6)), conf022);
        // votes unchanged by actual withdrawal
        await waitWithdrawFrom(cns0);
        await check_refresh(st, tid, cns0, tx_withdraw(cns0), conf022);
      });
      it("explicit cancel non-lockup stayed above minstake", async function() {
        let { st, tid, cns0 } = await deploy_create(conf222);
        await check_refresh(st, tid, cns0, tx_approve(cns0, toPeb(5e6)), conf122);
        // votes restored by cancelling the approval
        await check_refresh(st, tid, cns0, tx_cancel(cns0), conf222);
      });
      it("explicit cancel non-lockup fell below minstake", async function() {
        let { st, tid, cns0 } = await deploy_create(conf222);
        await check_refresh(st, tid, cns0, tx_approve(cns0, toPeb(9e6)), conf022);
        // votes restored by cancelling the approval
        await check_refresh(st, tid, cns0, tx_cancel(cns0), conf222);
      });
      it("timeout cancel non-lockup stayed above minstake", async function() {
        let { st, tid, cns0 } = await deploy_create(conf222);
        await check_refresh(st, tid, cns0, tx_approve(cns0, toPeb(5e6)), conf122);
        // votes restored by cancelling (due to timeout) the approval
        await waitWithdrawUntil(cns0);
        await check_refresh(st, tid, cns0, tx_withdraw(cns0), conf222);
      });
      it("timeout cancel non-lockup fell above minstake", async function() {
        let { st, tid, cns0 } = await deploy_create(conf222);
        await check_refresh(st, tid, cns0, tx_approve(cns0, toPeb(9e6)), conf022);
        // votes restored by cancelling (due to timeout) the approval
        await waitWithdrawUntil(cns0);
        await check_refresh(st, tid, cns0, tx_withdraw(cns0), conf222);
      });
    }); // trigger by CnStaking

    describe("tracker timing", function() {
      it("trigger by explicit refresh call", async function() {
        let { st, cns0 } = await E.deploy_get_cns0(conf111, false);
        let { tid } = await E.must_create(st);

        // refreshStake() is not automatically invoked.
        // Balance change is unrecognized
        await expect(tx_stake(cns0, toPeb(5e6)))
          .to.not.emit(st, "RefreshStake");
        await E.check_tracker(st, tid, conf111);

        // Anyone can invoke refreshStake()
        // Balance change is recognized
        await expect(st.connect(E.other1).refreshStake(cns0.address))
          .to.emit(st, "RefreshStake").withArgs(tid, NA01, cns0.address, toPeb(10e6), toPeb(10e6), 2, 4);
        await E.check_tracker(st, tid, conf211);
      });
      it("update just before trackEnd", async function() {
        let { st, tid, te, cns0 } = await deploy_create(conf111);

        // Change the balance at exactly blocknum (te - 1).
        await setBlock(te - 2);
        await expect(tx_stake(cns0, toPeb(5e6))).to.emit(st, "RefreshStake");
        await expect(await nowBlock()).to.equal(te - 1);

        await E.check_tracker(st, tid, conf211);
      });
      it("no updates after trackEnd", async function() {
        let { st, tid, te, cns0 } = await deploy_create(conf111);

        // Change the balance at exactly blocknum (te).
        await setBlock(te - 1);
        await expect(tx_stake(cns0, toPeb(5e6))).to.not.emit(st, "RefreshStake");
        await expect(await nowBlock()).to.equal(te);

        await E.check_tracker(st, tid, conf111);
      });
      it("partial updates after trackEnd", async function() {
        // Create three trackers with different trackEnd blocks.
        let { st, cns0 } = await E.deploy_get_cns0(conf111);
        let [ tid1, ts1, te1 ] = await E.must_create_a(st, E.deployer, 60);
        let [ tid2, ts2, te2 ] = await E.must_create_a(st, E.deployer, 120);
        let [ tid3, ts3, te3 ] = await E.must_create_a(st, E.deployer, 180);

        await E.check_tracker(st, tid1, conf111, ts1, te1);
        await E.check_tracker(st, tid2, conf111, ts2, te2);
        await E.check_tracker(st, tid3, conf111, ts3, te3);

        // Wait until tid1 expires
        await setBlock(te1);
        // Updating balance will trigger RefreshStake of tid2 and tid3.
        let commonArgs = [NA01, cns0.address, toPeb(10e6), toPeb(10e6), 2, 4];
        await expect(tx_stake(cns0, toPeb(5e6)))
          .to.emit(st, "RefreshStake").withArgs(tid2, ...commonArgs)
          .to.emit(st, "RefreshStake").withArgs(tid3, ...commonArgs);

        await E.check_tracker(st, tid1, conf111, ts1, te1); // tid1 unchanged
        await E.check_tracker(st, tid2, conf211, ts2, te2); // tid2 changed
        await E.check_tracker(st, tid3, conf211, ts3, te3); // tid3 changed
      });

      async function check_retire(st, retired_tids) {
        // Trigger deletion of old trackers
        let e = expect(st.refreshStake(NULL_ADDR));
        for (var tid of retired_tids) {
          e = e.to.emit(st, "RetireTracker").withArgs(tid);
        }
        await e;
      }

      it("retire old trackers", async function() {
        // Create 5 trackers with different trackEnd blocks.
        let { st } = await E.deploy_get_cns0(conf111);
        let [ tid1, ts1, te1 ] = await E.must_create_a(st, E.deployer, 20); // ##
        let [ tid2, ts2, te2 ] = await E.must_create_a(st, E.deployer, 10); // #
        let [ tid3, ts3, te3 ] = await E.must_create_a(st, E.deployer, 30); // ###
        let [ tid4, ts4, te4 ] = await E.must_create_a(st, E.deployer, 40); // ####
        let [ tid5, ts5, te5 ] = await E.must_create_a(st, E.deployer, 50); // #####
        await E.check_allIds(st, [1,2,3,4,5]);
        await E.check_liveIds(st, [1,2,3,4,5]);

        // Note: liveTrackerIds order is not preserved during deletion

        // Delete middle element
        await setBlock(te2);
        await check_retire(st, [2]);
        await E.check_liveIds(st, [1,5,3,4]);

        // Delete first element
        await setBlock(te1);
        await check_retire(st, [1]);
        await E.check_liveIds(st, [4,5,3]);

        // Delete last element
        await setBlock(te3);
        await check_retire(st, [3]);
        await E.check_liveIds(st, [4,5]);

        // Delete two elements at once
        await setBlock(te5);
        await check_retire(st, [4,5]);
        await E.check_liveIds(st, []);

        // allTrackerIds unchanged
        await E.check_allIds(st, [1,2,3,4,5]);
      });
    }); // tracker timing
  }); // refreshStake
}
