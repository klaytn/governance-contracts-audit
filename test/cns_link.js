const _ = require("lodash");
const { ethers } = require("hardhat");
const { expect } = require("chai");
const { constants } = require("@openzeppelin/test-helpers");
const { nowTime, setTime, toPeb, addPebs, subPebs, expectRevert } = require("./helper.js");

const NULL_ADDR = constants.ZERO_ADDRESS;
const RAND_ADDR = "0xe3B0C44298FC1C149AfBF4C8996fb92427aE41E4"; // non-null placeholder

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

      beforeEach(async function() {
        await cns.mockSetAddressBookAddress(E.abook.address);
      });

      it("success", async function() {
        await E.must_func(cns, E.admin1, 'UpdateRewardAddress', [RAND_ADDR], [RAND_ADDR]);
      });
      it("AddressBook event", async function() {
        await expect(tx_update(cns, RAND_ADDR))
              .to.emit(E.abook, "ReviseRewardAddress")
              .withArgs(NULL_ADDR /* nodeId */, NULL_ADDR /* prev */, RAND_ADDR /* curr */);
      });
      it("reject null address", async function() {
        await expectRevert(tx_update(cns, NULL_ADDR), "Address is null");
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
    }); // UpdateVoterAddress
  });
}
