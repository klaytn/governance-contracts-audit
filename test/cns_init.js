const _ = require("lodash");
const { ethers } = require("hardhat");
const { expect } = require("chai");
const { constants } = require("@openzeppelin/test-helpers");
const { nowTime, toPeb, addPebs, expectRevert } = require("./helper.js");

const NULL_ADDR = constants.ZERO_ADDRESS;
const RAND_ADDR = "0xe3B0C44298FC1C149AfBF4C8996fb92427aE41E4"; // non-null placeholder

module.exports = function(E) {

  describe("init", function() {

    describe("contructor", function() {
      it("success", async function() {
        await E.deploy();
      });
      it("public states", async function() {
        let cns = await E.deploy();
        await expect(await cns.contractValidator()).to.equal(E.cvAddr);
        await expect(await cns.requirement()).to.equal(E.req);
        await expect(await cns.nodeId()).to.equal(E.nodeId);
        await expect(await cns.rewardAddress()).to.equal(E.rewardAddr);
        await expect(await cns.isInitialized()).to.equal(false);
      });
      it("reject null addresses", async function() {
        await expectRevert(E.deploy({ cvAddr: NULL_ADDR }), "Address is null");
        await expectRevert(E.deploy({ nodeId: NULL_ADDR }), "Address is null");
        await expectRevert(E.deploy({ rewardAddr: NULL_ADDR }), "Address is null");
      });
      it("reject impossible requirement", async function() {
        // _requirement <= _adminCount
        await expectRevert(E.deploy({ req: 4 }), "Invalid requirement.");
        // _requirement != 0
        await expectRevert(E.deploy({ req: '0' }), "Invalid requirement.");
        // _adminCount != 0
        await expectRevert(E.deploy({ admins: [] }), "Invalid requirement.");
      });
      it("reject bad adminList", async function() {
        await expectRevert(E.deploy({ admins: [NULL_ADDR], req: 1 }),
          "Address is null or not unique."); // null
        await expectRevert(
          E.deploy({ admins: [E.admin1.address, E.admin1.address], req: 1 }),
          "Address is null or not unique."); // not unique
      });
      it("reject initial lockup of bad lengths", async function() {
        await expectRevert(E.deploy({ times: [] }),
          "Invalid unlock time and amount."); // _unlockTime.length != 0
        await expectRevert(E.deploy({ amounts: [] }),
          "Invalid unlock time and amount."); // _unlockAmount.length != 0
        await expectRevert(E.deploy({ amounts: [E.amount1] }),
          "Invalid unlock time and amount."); // _unlockTime.length == _unlockAmount.length
      });
      it("reject initial lockup times out of order", async function() {
        let now = await nowTime();
        await expectRevert(E.deploy({ times: [now-10, now+0] }),
          "Unlock time is not in ascending order."); // earlier than block.timestamp
        await expectRevert(E.deploy({ times: [now+10, now+5] }),
          "Unlock time is not in ascending order."); // out of order
      });
      it("reject zero initial lockup amounts", async function() {
        await expectRevert(E.deploy({ amounts: [E.amount1, 0] }),
          "Amount is not positive number.");
      });
    }); // constructor

    describe("constants", function() {
      it("success", async function() {
        // contribute to the code coverage of the original contract
        let CnStakingV2 = await ethers.getContractFactory("CnStakingV2");
        let cns = await E.deploy({ Factory: CnStakingV2 });
        expect(await cns.MAX_ADMIN()).to.equal(50);
        expect(await cns.CONTRACT_TYPE()).to.equal("CnStakingContract");
        expect(await cns.VERSION()).to.equal(2);
        expect(await cns.ADDRESS_BOOK_ADDRESS())
          .to.equal("0x0000000000000000000000000000000000000400");
        expect(await cns.STAKE_LOCKUP()).to.equal(604800);
      });
    }); // constants

    describe("setStakingTracker", function() {
      let cns;
      beforeEach(async function() {
        cns = await E.deploy();
      });

      it("success", async function() {
        await E.must_setStakingTracker(cns, E.cv, E.trackerAddr);
      });
      it("reject after init", async function() {
        await E.init(cns);
        await E.revert_setStakingTracker(cns, E.admin1, E.trackerAddr,
          "Contract has been initialized.");
      });
      it("reject non-admin", async function() {
        await E.revert_setStakingTracker(cns, E.other1, E.trackerAddr,
          "Address is not admin.");
      });
      it("reject null address", async function() {
        await E.revert_setStakingTracker(cns, E.admin1, NULL_ADDR,
          "Address is null");
      });
      it("reject non-contract", async function() {
        await E.revert_setStakingTracker(cns, E.admin1, RAND_ADDR,
          "function call to a non-contract account");
      });
      it("reject invalid contract compare", async function() {
        let Invalid = await ethers.getContractFactory("StakingTrackerMockWrong");
        let invalid = await Invalid.deploy();
        await E.revert_setStakingTracker(cns, E.admin1, invalid.address,
          "Invalid contract");
      });
      it("reject invalid contract reverts", async function() {
        let Invalid = await ethers.getContractFactory("StakingTrackerMockInvalid");
        let invalid = await Invalid.deploy();
        await E.revert_setStakingTracker(cns, E.admin1, invalid.address,
          "function selector was not recognized and there's no fallback function");
      });
    }); // setStakingTracker

    describe("reviewInitialConditions", function() {
      let cns;
      beforeEach(async function() {
        cns = await E.deploy();
      });

      it("success", async function() {
        await E.must_reviewInitialConditions(cns, E.cv);
        await E.must_reviewInitialConditions(cns, E.admin1);
        await E.must_reviewInitialConditions(cns, E.admin2);
        await E.must_reviewInitialConditions(cns, E.admin3, true);

        let cond = await cns.lockupConditions();
        await expect(cond.allReviewed).to.equal(true);
        await expect(cond.reviewedCount).to.equal(4);
        await expect(await cns.contractValidator()).to.equal(E.cvAddr);
        await expect(await cns.isInitialized()).to.equal(false);
      });
      it("reject after init", async function() {
        await E.init(cns);
        await E.revert_reviewInitialConditions(cns, E.admin1,
          "Contract has been initialized.");
      });
      it("reject non-admin", async function() {
        await E.revert_reviewInitialConditions(cns, E.other1,
          "Address is not admin.");
      });
      it("reject duplicate", async function() {
        await E.must_reviewInitialConditions(cns, E.admin1);
        await E.revert_reviewInitialConditions(cns, E.admin1,
          "Msg.sender already reviewed.");
      });
    }); // reviewInitialConditions

    describe("depositLockupStakingAndInit", function() {
      let cns;
      beforeEach(async function() {
        cns = await E.deploy();
      });

      it("success", async function() {
        await E.must_reviewInitialConditions(cns, E.cv);
        await E.must_reviewInitialConditions(cns, E.admin1);
        await E.must_reviewInitialConditions(cns, E.admin2);
        await E.must_reviewInitialConditions(cns, E.admin3, true);

        await E.must_depositLockupStakingAndInit(cns, E.cv, E.initDepositAmount);

        expect(await cns.contractValidator()).to.equal(NULL_ADDR);
        expect(await cns.isInitialized()).to.equal(true);
      });
      it("reject after init", async function() {
        await E.init(cns);
        await E.revert_depositLockupStakingAndInit(cns, E.cv, E.initDepositAmount,
          "Contract has been initialized.");
      });
      it("reject before review", async function() {
        await E.revert_depositLockupStakingAndInit(cns, E.cv, E.initDepositAmount,
          "Reviewing is not finished.");
      });
      it("reject wrong amount", async function() {
        await E.must_reviewInitialConditions(cns, E.cv);
        await E.must_reviewInitialConditions(cns, E.admin1);
        await E.must_reviewInitialConditions(cns, E.admin2);
        await E.must_reviewInitialConditions(cns, E.admin3, true);

        let wrongAmount = addPebs(E.initDepositAmount, 1);
        await E.revert_depositLockupStakingAndInit(cns, E.cv, wrongAmount,
          "Value does not match.");
      });
    }); // depositLockupStakingAndInit

    describe("getReviewers", function() {
      async function check_reviewers(cns, reviewers) {
        expect(await cns.getReviewers()).to.equalAddrList(reviewers);
      }

      it("success before init", async function() {
        // reviewers are in order of [cv, admins], regardless of review timings
        let cns = await E.deploy();
        await check_reviewers(cns, []);

        await E.must_reviewInitialConditions(cns, E.admin3);
        await E.must_reviewInitialConditions(cns, E.cv);
        await check_reviewers(cns, [E.cv, E.admin3]);

        await E.must_reviewInitialConditions(cns, E.admin1);
        await E.must_reviewInitialConditions(cns, E.admin2);
        await check_reviewers(cns, [E.cv, E.admin1, E.admin2, E.admin3]);
      });
      it("reject after init", async function() {
        let cns = await E.deployInit();
        await expectRevert(cns.getReviewers(), "Contract has been initialized.");
      });
    }); // getReviewers

    describe("getState", function() {
      let times, amounts;
      before(async function() {
        let now = await nowTime();
        times = [now+100, now+200];
        amounts = [toPeb(1), toPeb(2)];
      });

      it("success before init", async function() {
        let cns = await E.deploy({ times, amounts });
        let state = await cns.getState();
        await expect(state[0]).to.equal(E.cvAddr);
        await expect(state[1]).to.equal(E.nodeId);
        await expect(state[2]).to.equal(E.rewardAddr);
        await expect(state[3]).to.equalAddrList(E.admins);
        await expect(state[4]).to.equal(E.req);
        await expect(state[5]).to.equalNumberList(times);
        await expect(state[6]).to.equalNumberList(amounts);
        await expect(state[7]).to.equal(false); // _allReviewed
        await expect(state[8]).to.equal(false); // _isInitialized
      });
      it("success after init", async function() {
        let cns = await E.deployInit({ times, amounts });
        let state = await cns.getState();
        await expect(state[0]).to.equal(NULL_ADDR); // _contractValidator
        await expect(state[1]).to.equal(E.nodeId);
        await expect(state[2]).to.equal(E.rewardAddr);
        await expect(state[3]).to.equalAddrList(E.admins);
        await expect(state[4]).to.equal(E.req);
        await expect(state[5]).to.equalNumberList(times);
        await expect(state[6]).to.equalNumberList(amounts);
        await expect(state[7]).to.equal(true); // _allReviewed
        await expect(state[8]).to.equal(true); // _isInitialized
      });
    }); // getState

  });
}
