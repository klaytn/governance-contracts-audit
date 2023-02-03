const _ = require("lodash");
const { ethers } = require("hardhat");
const { expect } = require("chai");
const { constants } = require("@openzeppelin/test-helpers");
const { numericAddr, nowTime, setTime, toPeb, addPebs, subPebs, expectRevert } = require("./helper.js");

const NULL_ADDR = constants.ZERO_ADDRESS;
const RAND_ADDR = "0xe3B0C44298FC1C149AfBF4C8996fb92427aE41E4"; // non-null placeholder
const NA = numericAddr;

module.exports = function(E) {

  describe("external account links", function() {
    let cns;
    beforeEach(async function() {
      cns = await E.deployInit({ req: 1, tracker: E.trackerAddr });
    });

    describe("UpdateRewardAddress", function() {
      function tx_update(cns, addr) {
        return E.tx_submit(cns, E.admin1, 'UpdateRewardAddress', [addr]);
      }
      function tx_accept(cns, sender) {
        return cns.connect(sender).acceptRewardAddress();
      }

      beforeEach(async function() {
        await cns.mockSetAddressBookAddress(E.abook.address);
      });

      it("success by accepting from reward address", async function() {
        let reward = E.other1;
        let rewardAddr = E.other1.address;

        await E.must_func(cns, E.admin1, 'UpdateRewardAddress', [rewardAddr], [rewardAddr]);
        expect(await cns.pendingRewardAddress()).to.equal(rewardAddr);

        await expect(tx_accept(cns, reward))
            .to.emit(cns, "AcceptRewardAddress").withArgs(rewardAddr)
            .to.emit(E.abook, "ReviseRewardAddress");
        expect(await cns.pendingRewardAddress()).to.equal(NULL_ADDR);
        expect(await cns.rewardAddress()).to.equal(rewardAddr);
      });
      it("success by accepting from AddressBook admin", async function() {
        let reward = E.other1;
        let rewardAddr = E.other1.address;

        await E.must_func(cns, E.admin1, 'UpdateRewardAddress', [rewardAddr], [rewardAddr]);
        expect(await cns.pendingRewardAddress()).to.equal(rewardAddr);

        // Note that E.cv is an admin of AddressBook
        let adminList = (await E.abook.getState())[0];
        expect(adminList).to.contain(E.cv.address);

        await expect(tx_accept(cns, E.cv))
            .to.emit(cns, "AcceptRewardAddress").withArgs(rewardAddr)
            .to.emit(E.abook, "ReviseRewardAddress");
        expect(await cns.pendingRewardAddress()).to.equal(NULL_ADDR);
        expect(await cns.rewardAddress()).to.equal(rewardAddr);
      });
      it("cancel update by nullifying pendingRewardAddress", async function() {
        await E.must_func(cns, E.admin1, 'UpdateRewardAddress', [RAND_ADDR], [RAND_ADDR]);
        expect(await cns.pendingRewardAddress()).to.equal(RAND_ADDR);

        await E.must_func(cns, E.admin1, 'UpdateRewardAddress', [NULL_ADDR], [NULL_ADDR]);
        expect(await cns.pendingRewardAddress()).to.equal(NULL_ADDR);
      });
      it("reject accept by other", async function() {
        await E.must_func(cns, E.admin1, 'UpdateRewardAddress', [RAND_ADDR], [RAND_ADDR]);
        expect(await cns.pendingRewardAddress()).to.equal(RAND_ADDR);

        await expectRevert(tx_accept(cns, E.other2), "Unauthorized to accept reward address");
        expect(await cns.pendingRewardAddress()).to.equal(RAND_ADDR);
      });
    }); // UpdateRewardAddress

    describe("UpdateStakingTracker", function() {
      function tx_update(cns, addr) {
        return E.tx_submit(cns, E.admin1, 'UpdateStakingTracker', [addr]);
      }

      it("success", async function() {
        await E.must_func(cns, E.admin1, 'UpdateStakingTracker', [E.trackerAddr], [E.trackerAddr]);
      });
      it("reject null address", async function() {
        await expectRevert(tx_update(cns, NULL_ADDR), "Address is null");
      });
      it("reject non-contract", async function() {
        await expectRevert(tx_update(cns, RAND_ADDR), "function call to a non-contract account");
      });
      it("reject when there is an active tracker", async function() {
        let Active = await ethers.getContractFactory("StakingTrackerMockActive");
        let active = await Active.deploy();
        // first, change to live succeeds
        await E.must_func(cns, E.admin1, 'UpdateStakingTracker', [active.address], [active.address]);
        // then, change back will fail
        await expectRevert(tx_update(cns, E.tracker.address), "Cannot update tracker when there is an active tracker");
      });
      it("reject invalid contract with wrong version", async function() {
        let Invalid = await ethers.getContractFactory("StakingTrackerMockWrong");
        let invalid = await Invalid.deploy();
        await expectRevert(tx_update(cns, invalid.address), "Invalid contract");
      });
      it("reject invalid contract that reverts", async function() {
        let Invalid = await ethers.getContractFactory("StakingTrackerMockInvalid");
        let invalid = await Invalid.deploy();
        await expectRevert(tx_update(cns, invalid.address),
          "function selector was not recognized and there's no fallback function");
      });
    }); // UpdateStakingTracker

    describe("UpdateVoterAddress", function() {
      function tx_update(cns, addr) {
        return E.tx_submit(cns, E.admin1, 'UpdateVoterAddress', [addr]);
      }

      it("success", async function() {
        await E.must_func(cns, E.admin1, 'UpdateVoterAddress', [RAND_ADDR], [RAND_ADDR]);
      });
      it("success null address", async function() {
        await E.must_func(cns, E.admin1, 'UpdateVoterAddress', [NULL_ADDR], [NULL_ADDR]);
      });
      it("refresh voter", async function() {
        await expect(tx_update(cns, RAND_ADDR)).to.emit(E.tracker, "RefreshVoter");
      });
      it("refresh voter skipped if tracker is null", async function() {
        cns = await E.deployInit({ req: 1, });
        await expect(tx_update(cns, RAND_ADDR)).to.not.emit(E.tracker, "RefreshVoter");
      });

      it("reject voter already taken", async function() {
        let ABook = await ethers.getContractFactory("AddressBookMock");
        let abook = await ABook.deploy();
        await abook.constructContract([], 0);

        let Tracker = await ethers.getContractFactory("StakingTrackerMock");
        let tracker = await Tracker.deploy();
        await tracker.mockSetAddressBookAddress(abook.address);

        let [nodeA, nodeB, rewardA, rewardB] = [NA(0,1), NA(1,1), NA(0,9), NA(1,9)];
        let cnsA = await E.deployInit({ req: 1, tracker: tracker.address, nodeId: nodeA, rewardAddr: rewardA });
        let cnsB = await E.deployInit({ req: 1, tracker: tracker.address, nodeId: nodeB, rewardAddr: rewardB });
        await abook.mockRegisterCnStakingContracts(
          [nodeA, nodeB],
          [cnsA.address, cnsB.address],
          [rewardA, rewardB]);

        let voter = RAND_ADDR;
        await expect(tx_update(cnsA, voter)).to.emit(tracker, "RefreshVoter");
        expect(await tracker.voterToNodeId(voter)).to.equal(nodeA); // voter -> nodeA mapping created

        await expectRevert(tx_update(cnsB, voter), "Voter address already taken");
        expect(await tracker.voterToNodeId(voter)).to.equal(nodeA); // voter -> nodeA mapping retained
      });
      it("reject voter already taken concurrent", async function() {
        let ABook = await ethers.getContractFactory("AddressBookMock");
        let abook = await ABook.deploy();
        await abook.constructContract([], 0);

        let Tracker = await ethers.getContractFactory("StakingTrackerMock");
        let tracker = await Tracker.deploy();
        await tracker.mockSetAddressBookAddress(abook.address);

        let [nodeA, nodeB, rewardA, rewardB] = [NA(0,1), NA(1,1), NA(0,9), NA(1,9)];
        let cnsA = await E.deployInit({ req: 1, tracker: tracker.address, nodeId: nodeA, rewardAddr: rewardA });
        let cnsB = await E.deployInit({ req: 2, tracker: tracker.address, nodeId: nodeB, rewardAddr: rewardB });
        await abook.mockRegisterCnStakingContracts(
          [nodeA, nodeB],
          [cnsA.address, cnsB.address],
          [rewardA, rewardB]);

        let voter = RAND_ADDR;
        // submitUpdateVoterAddress succeeds
        await E.tx_submit(cnsB, E.admin1, 'UpdateVoterAddress', [voter]);

        // In the meantime, other CN takes the voter address
        await expect(tx_update(cnsA, voter)).to.emit(tracker, "RefreshVoter");
        expect(await tracker.voterToNodeId(voter)).to.equal(nodeA); // voter -> nodeA mapping created

        // updateVoterAddress fails
        await expect(E.tx_confirm(cnsB, E.admin2, 0, 'UpdateVoterAddress', [voter]))
          .to.emit(cnsB, "ExecuteRequestFailure");
        expect(await tracker.voterToNodeId(voter)).to.equal(nodeA); // voter -> nodeA mapping retained
      });


    }); // UpdateVoterAddress
  });
}
