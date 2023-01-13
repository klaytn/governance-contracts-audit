const _ = require("lodash");
const { ethers } = require("hardhat");
const { expect } = require("chai");
const { constants } = require("@openzeppelin/test-helpers");
const { nowTime, setTime, toPeb, addPebs, subPebs, expectRevert } = require("./helper.js");

const NULL_ADDR = constants.ZERO_ADDRESS;
const RAND_ADDR = "0xe3B0C44298FC1C149AfBF4C8996fb92427aE41E4"; // non-null placeholder

module.exports = function(E) {

  describe("non-lockup free stakes", function() {
    let out, amt;
    before(async function() {
      out = E.other2.address;
      amt = toPeb(1000);
    });

    function tx_stake(cns, amt, method) {
      let bigAmt = ethers.BigNumber.from(amt);
      if (method == 'function') {
        return cns.connect(E.other1).stakeKlay({ value: bigAmt });
      } else {
        return E.other1.sendTransaction({ to: cns.address, value: bigAmt });
      }
    }
    async function must_stake(cns, amt, method) {
      let sender = E.other1;
      let pre = await E.query_stakes(cns, sender);
      await expect(tx_stake(cns, amt, method))
        .to.emit(cns, "StakeKlay").withArgs(sender.address, amt);
      let post = await E.query_stakes(cns, sender);

      expect(post.initial).to.equal(pre.initial);                 // initial lockup unchanged
      expect(post.remain).to.equal(pre.remain);                   // initial lockup unchanged
      expect(post.withdrawable).to.equal(post.withdrawable);      // initial lockup unchanged
      expect(post.staking).to.equal(addPebs(pre.staking, amt));   // staking += amt
      if (post.unstaking)                                         // V1 doesn't have unstaking()
        expect(post.unstaking).to.equal(pre.unstaking);           // unstaking unchanged
      expect(post.balCns).to.equal(addPebs(pre.balCns, amt));     // cns += amt
      // balOther check is inaccurate because of the gas fee
      // expect(post.balOther).to.equal(subPebs(pre.balOther, amt)); // other -= amt
    }
    async function revert_stake(cns, amt, method, msg) {
      await expectRevert(tx_stake(cns, amt, method), msg);
    }

    function tx_submit_approve(cns, amt) {
      return E.tx_submit(cns, E.admin1, 'ApproveStakingWithdrawal', [out, amt]);
    }
    function tx_confirm_approve(cns, rid, amt) {
      return E.tx_confirm(cns, E.admin2, rid, 'ApproveStakingWithdrawal', [out, amt]);
    }
    async function must_approve(cns, amt) {
      let pre = await E.query_stakes(cns, out);
      let fromTime = await E.calc_fromTime(cns);
      await E.must_func(cns, E.admin1, 'ApproveStakingWithdrawal', [out, amt],
                        [0, out, amt, fromTime]);
      let post = await E.query_stakes(cns, out);

      expect(post.initial).to.equal(pre.initial);                     // initial lockup unchanged
      expect(post.remain).to.equal(pre.remain);                       // initial lockup unchanged
      expect(post.withdrawable).to.equal(post.withdrawable);          // initial lockup unchanged
      expect(post.staking).to.equal(pre.staking);                     // staking unchanged
      if (post.unstaking)                                             // V1 doesn't have unstaking()
        expect(post.unstaking).to.equal(addPebs(pre.unstaking, amt)); // unstaking += amt
      expect(post.balCns).to.equal(pre.balCns);                       // cns unchanged
      expect(post.balOther).to.equal(pre.balOther);                   // other unchanged
    }
    async function revert_approve(cns, amt, msg) {
      await E.revert_func(cns, E.admin1, 'ApproveStakingWithdrawal', [out, amt], msg);
    }

    function tx_submit_cancel(cns, wid) {
      return E.tx_submit(cns, E.admin1, 'CancelApprovedStakingWithdrawal', [wid]);
    }
    function tx_confirm_cancel(cns, rid, wid) {
      return E.tx_confirm(cns, E.admin2, rid, 'CancelApprovedStakingWithdrawal', [wid]);
    }
    async function must_cancel(cns, id, amt) {
      let pre = await E.query_stakes(cns, out);
      await E.must_func(cns, E.admin1, 'CancelApprovedStakingWithdrawal', [id],
                        [id, out, amt]);
      let post = await E.query_stakes(cns, out);

      expect(post.initial).to.equal(pre.initial);                     // initial lockup unchanged
      expect(post.remain).to.equal(pre.remain);                       // initial lockup unchanged
      expect(post.withdrawable).to.equal(post.withdrawable);          // initial lockup unchanged
      expect(post.staking).to.equal(pre.staking);                     // staking unchanged
      if (post.unstaking)                                             // V1 doesn't have unstaking()
        expect(post.unstaking).to.equal(subPebs(pre.unstaking, amt)); // unstaking -= amt
      expect(post.balCns).to.equal(pre.balCns);                       // cns unchanged
      expect(post.balOther).to.equal(pre.balOther);                   // other unchanged
    }
    async function revert_cancel(cns, id, msg) {
      await E.revert_func(cns, E.admin1, 'CancelApprovedStakingWithdrawal', [id], msg);
    }

    function tx_withdraw(cns, wid) {
      return cns.connect(E.admin1).withdrawApprovedStaking(wid);
    }
    async function must_withdraw(cns, id, amt) {
      let pre = await E.query_stakes(cns, out);
      await expect(tx_withdraw(cns, id))
        .to.emit(cns, "WithdrawApprovedStaking").withArgs(id, out, amt);
      let post = await E.query_stakes(cns, out);

      expect(post.initial).to.equal(pre.initial);                     // initial lockup unchanged
      expect(post.remain).to.equal(pre.remain);                       // initial lockup unchanged
      expect(post.withdrawable).to.equal(post.withdrawable);          // initial lockup unchanged
      expect(post.staking).to.equal(subPebs(pre.staking, amt));       // staking -= amt
      if (post.unstaking)                                             // V1 doesn't have unstaking()
        expect(post.unstaking).to.equal(subPebs(pre.unstaking, amt)); // unstaking -= amt
      expect(post.balCns).to.equal(subPebs(pre.balCns, amt));         // cns -= amt
      expect(post.balOther).to.equal(addPebs(pre.balOther, amt));     // other += amt
    }
    async function revert_withdraw(cns, id, msg) {
      await expectRevert(tx_withdraw(cns, id), msg);
    }

    describe("stakeKlay", function() {
      let cns;
      beforeEach(async function() {
        cns = await E.deployInit({ tracker: E.trackerAddr });
      });
      it("success", async function() {
        await must_stake(cns, amt, 'function');
        await must_stake(cns, amt, 'fallback');
      });
      it("refresh stake", async function() {
        await expect(tx_stake(cns, amt, 'function')).to.emit(E.tracker, "RefreshStake");
        await expect(tx_stake(cns, amt, 'fallback')).to.emit(E.tracker, "RefreshStake");
      });
      it("reject before init", async function() {
        cns = await E.deploy();
        await revert_stake(cns, amt, 'function', "Contract is not initialized.");
        await revert_stake(cns, amt, 'fallback', "Contract is not initialized.");
      });
      it("reject zero amount", async function() {
        await revert_stake(cns, 0, 'function', "Invalid amount.");
        await revert_stake(cns, 0, 'fallback', "Invalid amount.");
      });
    }); // stakeKlay

    describe("ApproveStakingWithdrawal", function() {
      let cns;
      beforeEach(async function() {
        cns = await E.deployInit({ req: 1, tracker: E.trackerAddr });
      });

      it("success", async function() {
        await must_stake(cns, amt);
        await must_approve(cns, amt);
        await E.check_WithdrawalState(cns, 0, 'Unknown');
      });
      it("refresh stake", async function() {
        await must_stake(cns, amt);
        await expect(tx_submit_approve(cns, amt)).to.emit(E.tracker, "RefreshStake");
      });
      it("reject null recipient", async function() {
        await E.revert_func(cns, E.admin1, 'ApproveStakingWithdrawal',
                            [NULL_ADDR, amt], "Address is null");
      });
      it("reject zero amount", async function() {
        await revert_approve(cns, 0, "Invalid value.");
      });
      it("reject too much amount", async function() {
        await must_stake(cns, amt);
        await revert_approve(cns, addPebs(amt, 1), "Invalid value.");
      });
      it("reject too much amount concurrent", async function() {
        cns = await E.deployInit({ req: 2 });
        await must_stake(cns, amt);

        // Both requests wish to approve the full withdrawal
        await tx_submit_approve(cns, amt); // ReqID 0
        await tx_submit_approve(cns, amt); // ReqID 1

        // ReqID 0 confirm ok
        await tx_confirm_approve(cns, 0, amt);
        // ReqID 1 confirm fail
        await expect(tx_confirm_approve(cns, 1, amt)).to.emit(cns, "ExecuteRequestFailure");
      });
      it("reject too much outstanding unstaking", async function() {
        // Sum of withdrawal requests cannot exceed the current staking amount
        await must_stake(cns, amt);
        await must_approve(cns, amt);
        await revert_approve(cns, amt, "Too much outstanding withdrawal");
      });
    }); // ApproveStakingWithdrawal

    describe("CancelApprovedStakingWithdrawal", function() {
      let cns;
      beforeEach(async function() {
        cns = await E.deployInit({ req: 1, tracker: E.trackerAddr });
      });

      it("success", async function() {
        await must_stake(cns, amt);
        await must_approve(cns, amt);
        await must_cancel(cns, 0, amt);
        await E.check_WithdrawalState(cns, 0, 'Canceled');
      });
      it("refresh stake", async function() {
        await must_stake(cns, amt);
        await must_approve(cns, amt);
        await expect(tx_submit_cancel(cns, 0)).to.emit(E.tracker, "RefreshStake");
      });
      it("reject nonexistent id", async function() {
        await revert_cancel(cns, 999, "Withdrawal request does not exist.");
      });
      it("reject already canceled", async function() {
        await must_stake(cns, amt);
        await must_approve(cns, amt);
        await must_cancel(cns, 0, amt);
        await revert_cancel(cns, 0, "Invalid state.");
      });
      it("reject already canceled concurrent", async function() {
        cns = await E.deployInit({ req: 2 });
        await must_stake(cns, amt);

        await tx_submit_approve(cns, amt); // ReqID 0 = Approve ->  WithdrawID 0
        await tx_confirm_approve(cns, 0, amt);

        // Both requests wish to cancel WithdrawID 0
        await tx_submit_cancel(cns, 0);            // ReqID 1 = Cancel(WithdrawID 0)
        await tx_submit_cancel(cns, 0);            // ReqID 2 = Cancel(WithdrawID 0)

        await tx_confirm_cancel(cns, 1, 0);        // ReqID 1 confirm ok
        await expect(tx_confirm_cancel(cns, 2, 0)) // ReqID 2 confirm fail
              .to.emit(cns, "ExecuteRequestFailure");
      });
      it("reject already transferred", async function() {
        await must_stake(cns, amt);
        await must_approve(cns, amt);
        await setTime(await E.query_fromTime(cns, 0));
        await must_withdraw(cns, 0, amt);

        await revert_cancel(cns, 0, "Invalid state.");
      });
      it("reject already transferred concurrent", async function() {
        cns = await E.deployInit({ req: 2 });
        await must_stake(cns, amt);

        await tx_submit_approve(cns, amt);      // ReqID 0 = Approve -> WithdrawID 0
        await tx_confirm_approve(cns, 0, amt);

        await tx_submit_cancel(cns, 0);         // ReqID 1 = Cancel(WithdrawID 0)
        await setTime(await E.query_fromTime(cns, 0));
        await must_withdraw(cns, 0, amt);       // Withdraw(WithdrawId 0)

        await expect(tx_confirm_cancel(cns, 1, 0)) // ReqID 1 confirm fail
              .to.emit(cns, "ExecuteRequestFailure");
      });
    }); // CancelApprovedStakingWithdrawal

    describe("withdrawApprovedStaking", function() {
      let cns;
      beforeEach(async function() {
        cns = await E.deployInit({ req: 1, tracker: E.trackerAddr });
        await must_stake(cns, amt);
        await must_approve(cns, amt);
      });

      it("success", async function() {
        await setTime(await E.query_fromTime(cns, 0));
        await must_withdraw(cns, 0, amt);
        await E.check_WithdrawalState(cns, 0, 'Transferred');
      });
      it("refresh stake", async function() {
        await setTime(await E.query_fromTime(cns, 0));
        await expect(tx_withdraw(cns, 0)).to.emit(E.tracker, "RefreshStake");
      });
      it("reject call from non-admin", async function() {
        await expectRevert(cns.connect(E.other1).withdrawApprovedStaking(0),
                           "Address is not admin.");
      });
      it("reject nonexistent id", async function() {
        await revert_withdraw(cns, 999, "Withdrawal request does not exist.");
      });
      it("reject previously canceled", async function() {
        await must_cancel(cns, 0, amt);
        await revert_withdraw(cns, 0, "Invalid state.");
      });
      it("reject previously transferred", async function() {
        await setTime(await E.query_fromTime(cns, 0));
        await must_withdraw(cns, 0, amt);
        await revert_withdraw(cns, 0, "Invalid state.");
      });
      it("reject too early", async function() {
        let fromTime = await E.query_fromTime(cns, 0);
        await setTime(fromTime - 2);
        await revert_withdraw(cns, 0, "Not withdrawable yet.");
      });
      it("reject too late", async function() {
        let fromTime = await E.query_fromTime(cns, 0);
        let untilTime = fromTime + parseInt(await cns.STAKE_LOCKUP());
        await setTime(untilTime + 1);
        await expect(tx_withdraw(cns, 0))
              .to.emit(cns, "CancelApprovedStakingWithdrawal")
              .withArgs(0, out, amt);
        await E.check_WithdrawalState(cns, 0, 'Canceled');
      });
      it("reject bad recipient", async function() {
        let Recipient = await hre.ethers.getContractFactory("DenyingRecipient");
        let recipient = await Recipient.deploy();
        let out = recipient.address;

        cns = await E.deployInit({ req: 1 });
        await must_stake(cns, amt);

        await E.tx_submit(cns, E.admin1, 'ApproveStakingWithdrawal', [out, amt]);
        await setTime(await E.query_fromTime(cns, 0));
        await revert_withdraw(cns, 0, "Transfer failed.");
      });
    }); // withdrawApprovedStaking

    describe("getApprovedStakingWithdrawalIds", function() {
      async function check_ids(cns, from, to, state, expected) {
        expect(await cns.getApprovedStakingWithdrawalIds(from, to, state))
          .to.equalNumberList(expected);
      }

      it("search range", async function() {
        let cns = await E.deployInit({ req: 1 });
        await tx_stake(cns, toPeb(999999));
        await tx_submit_approve(cns, amt);
        await tx_submit_approve(cns, amt);
        await tx_submit_approve(cns, amt);
        await tx_submit_approve(cns, amt);
        let state = E.WithdrawlState.Unknown;

        // getApprovedStakingWithdrawalIds(from, to, state) searches in the range:
        // 1. [from, to)   if 0 < to < len
        // 2. [from, len)  if to == 0
        // 3. [from, len)  if to >= len

        // case 1
        await check_ids(cns, 0, 3, state, [0,1,2]);
        await check_ids(cns, 1, 2, state, [1]);
        await check_ids(cns, 2, 2, state, []);
        await check_ids(cns, 3, 2, state, []);
        // case 2
        await check_ids(cns, 0, 0, state, [0,1,2,3]);
        await check_ids(cns, 1, 0, state, [1,2,3]);
        await check_ids(cns, 4, 0, state, []);
        await check_ids(cns, 9, 0, state, []);
        // case 3
        await check_ids(cns, 0, 4, state, [0,1,2,3]);
        await check_ids(cns, 2, 9, state, [2,3]);
        await check_ids(cns, 4, 9, state, []);
        await check_ids(cns, 9, 9, state, []);
      });
      it("search states", async function() {
        let cns = await E.deployInit({ req: 1 });
        await tx_stake(cns, toPeb(999999));

        await tx_submit_approve(cns, amt);
        await tx_submit_approve(cns, amt);
        await tx_submit_approve(cns, amt);
        await tx_submit_approve(cns, amt);

        await setTime(await E.query_fromTime(cns, 3));
                                        // WithdrawID 0 = Unknown
        await tx_withdraw(cns, 1);      // WithdrawID 1 = Transferred
        await tx_submit_cancel(cns, 2); // WithdrawID 2 = Canceled
        await tx_withdraw(cns, 3);      // WithdrawID 3 = Transferred

        await check_ids(cns, 0, 0, E.WithdrawlState.Unknown, [0]);
        await check_ids(cns, 0, 0, E.WithdrawlState.Transferred, [1, 3]);
        await check_ids(cns, 0, 0, E.WithdrawlState.Canceled, [2]);
      });
    }); // getApprovedStakingWithdrawalIds

    describe("getApprovedStakingWithdrawalInfo", function() {
      it("success", async function() {
        let cns = await E.deployInit({ req: 1 });
        await tx_stake(cns, toPeb(999999));

        let fromTime = await E.calc_fromTime(cns);
        await tx_submit_approve(cns, amt);

        let info = await cns.getApprovedStakingWithdrawalInfo(0);
        expect(info[0]).to.equal(out);                      // to
        expect(info[1]).to.equal(amt);                      // value
        expect(info[2]).to.equal(fromTime);                 // withdrawableFrom
        expect(info[3]).to.equal(E.WithdrawlState.Unknown); // state
      });
    }); // getApprovedStakingWithdrawalInfo
  });
}
