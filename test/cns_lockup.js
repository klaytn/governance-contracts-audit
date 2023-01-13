const _ = require("lodash");
const { ethers } = require("hardhat");
const { expect } = require("chai");
const { constants } = require("@openzeppelin/test-helpers");
const { nowTime, setTime, getBalance, toPeb, addPebs, subPebs, expectRevert } = require("./helper.js");

const NULL_ADDR = constants.ZERO_ADDRESS;
const RAND_ADDR = "0xe3B0C44298FC1C149AfBF4C8996fb92427aE41E4"; // non-null placeholder

module.exports = function(E) {

  describe("initial lockup staking", function() {

    async function must_withdraw(cns, amt) {
      let pre = await E.query_stakes(cns, E.other1);
      await E.must_func(cns, E.admin1, 'WithdrawLockupStaking',
        [E.other1.address, amt], [E.other1.address, amt]);
      let post = await E.query_stakes(cns, E.other1);

      expect(post.initial).to.equal(pre.initial);                         // initial amount unchanged
      expect(post.remain).to.equal(subPebs(pre.remain, amt));             // remain -= amt
      expect(post.withdrawable).to.equal(subPebs(pre.withdrawable, amt)); // withdrawable -= amt
      expect(post.staking).to.equal(pre.staking);                         // free stakes unchanged
      if (post.unstaking)                                                 // V1 doesn't have unstaking()
        expect(post.unstaking).to.equal(pre.unstaking);                   // free stakes unchanged
      expect(post.balCns).to.equal(subPebs(pre.balCns, amt));             // cns -= amt
      expect(post.balOther).to.equal(addPebs(pre.balOther, amt));         // other += amt
    }

    async function revert_withdraw(cns, amt, msg) {
        await E.revert_func(cns, E.admin1, 'WithdrawLockupStaking', [E.other1.address, amt], msg);
    }

    describe("WithdrawLockupStaking", function() {
      it("success", async function() {
        let [t1] = [await nowTime() + 10000];
        let [v1] = [toPeb(1e6)];
        let cns = await E.deployInit({ req: 1, times: [t1], amounts: [v1] });

        await setTime(t1 + 1);
        await must_withdraw(cns, v1);
      });
      it("withdraw partial within one period", async function() {
        let [t1] = [await nowTime() + 10000];
        let [v1] = [toPeb(5e6)];
        let cns = await E.deployInit({ req: 1, times: [t1], amounts: [v1] });

        await setTime(t1 + 1);
        await must_withdraw(cns, toPeb(2e6));
        await must_withdraw(cns, toPeb(3e6));
      });
      it("withdraw partial over two periods", async function() {
        let [t1, t2] = [await nowTime() + 10000, await nowTime() + 20000];
        let [v1, v2] = [toPeb(10e5), toPeb(10e5)];
        let cns = await E.deployInit({ req: 1, times: [t1, t2], amounts: [v1, v2] });

        await setTime(t1 + 1);
        // [|||||||...][..........] ok
        await must_withdraw(cns, toPeb(7e5));
        // [|||||||***][*.........] fail
        await revert_withdraw(cns, toPeb(4e5), "Invalid value.");

        await setTime(t2 + 1);
        // [|||||||###][#####.....] ok
        await must_withdraw(cns, toPeb(8e5));
        // [|||||||###][#####*****]* fail
        await revert_withdraw(cns, toPeb(6e5), "Invalid value.");

        // [|||||||###][#####$$$$$] ok
        await must_withdraw(cns, toPeb(5e5));

        expect(await cns.remainingLockupStaking()).to.equal(0);
      });
      it("refresh stake", async function() {
        let [t1] = [await nowTime() + 10000];
        let [v1] = [toPeb(1e6)];
        let cns = await E.deployInit({ req: 1, times: [t1], amounts: [v1], tracker: E.trackerAddr });

        await setTime(t1 + 1);
        await expect(E.tx_submit(cns, E.admin1, 'WithdrawLockupStaking', [E.other1.address, toPeb(1e6)]))
          .to.emit(E.tracker, "RefreshStake");
      });
      it("reject null recipient", async function() {
        let cns = await E.deployInit({ req: 1 });
        await E.revert_func(cns, E.admin1, 'WithdrawLockupStaking',
                            [NULL_ADDR, toPeb(1)], "Address is null");
      });
      it("reject zero amount", async function() {
        let cns = await E.deployInit({ req: 1 });
        await revert_withdraw(cns, toPeb(0), "Invalid value.");
      });
      it("reject too much amount", async function() {
        let [t1] = [await nowTime() + 10000];
        let [v1] = [toPeb(1e6)];
        let cns = await E.deployInit({ req: 1, times: [t1], amounts: [v1] });

        await setTime(t1 + 1);
        await revert_withdraw(cns, toPeb(v1 + 1), "Invalid value.");
      });
      it("reject too much amount concurrent", async function() {
        let [t1] = [await nowTime() + 10000];
        let [v1] = [toPeb(10e5)];
        let [out, amt] = [E.other1.address, toPeb(7e5)];
        let cns = await E.deployInit({ req: 2, times: [t1], amounts: [v1] });

        // Both requests wish to take out the entire lockup
        await setTime(t1 + 1);
        await E.tx_submit(cns, E.admin1, 'WithdrawLockupStaking', [out, amt]); // submit ID 0
        await E.tx_submit(cns, E.admin1, 'WithdrawLockupStaking', [out, amt]); // submit ID 1

        // confirm ID 0 ok
        await E.tx_confirm(cns, E.admin2, 0, 'WithdrawLockupStaking', [out, amt]);
        // confirm ID 1 fail
        await expect(E.tx_confirm(cns, E.admin2, 1, 'WithdrawLockupStaking', [out, amt]))
          .to.emit(cns, "ExecuteRequestFailure");
      });
      it("reject bad recipient", async function() {
        let Recipient = await hre.ethers.getContractFactory("DenyingRecipient");
        let recipient = await Recipient.deploy();

        let [t1] = [await nowTime() + 10000];
        let [v1] = [toPeb(1e6)];
        let cns = await E.deployInit({ req: 1, times: [t1], amounts: [v1] });

        await setTime(t1 + 1);

        // Call this.withdrawLockupStaking() fails, but does not revert the entire tx.
        let tx = E.tx_submit(cns, E.admin1, 'WithdrawLockupStaking', [recipient.address, v1]);
        await expect(tx).to.emit(cns, "ExecuteRequestFailure");

        // No value transferred.
        expect(await getBalance(recipient.address)).to.equal(toPeb(0));
      });
    }); // WithdrawLockupStaking

    describe("getLockupStakingInfo", function() {
      async function check_withdrawable(cns, amt) {
        let info = await cns.getLockupStakingInfo();
        expect(info[4]).to.equal(amt);
      }

      it("success", async function() {
        let now = await nowTime();
        let times = [now+1000, now+2000, now+3000];
        let amounts = [toPeb(1e6), toPeb(2e6), toPeb(4e6)];
        let cns = await E.deployInit({ req: 1, times: times, amounts: amounts });

        var info = await cns.getLockupStakingInfo();
        expect(info[0]).to.equalNumberList(times);   // unlockTime
        expect(info[1]).to.equalNumberList(amounts); // unlockAmount
        expect(info[2]).to.equal(toPeb(7e6));        // initial
        expect(info[3]).to.equal(toPeb(7e6));        // remaining
        expect(info[4]).to.equal(0);                 // withdrawable

        await setTime(now+1000+1);
        await check_withdrawable(cns, toPeb(1e6));

        await setTime(now+2000+1);
        await check_withdrawable(cns, toPeb(3e6));

        await setTime(now+3000+1);
        await check_withdrawable(cns, toPeb(7e6));
      });
      it("reject before init", async function() {
        let cns = await E.deploy();
        await expectRevert(cns.getLockupStakingInfo(), "Contract is not initialized.");
      });
    }); // getLockupStakingInfo
  });
}
