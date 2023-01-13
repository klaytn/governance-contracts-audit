const _ = require("lodash");
const { ethers } = require("hardhat");
const { expect } = require("chai");
const { constants } = require("@openzeppelin/test-helpers");
const { nowTime, addPebs, expectRevert } = require("./helper.js");

const NULL_ADDR = constants.ZERO_ADDRESS;
const RAND_ADDR = "0xe3B0C44298FC1C149AfBF4C8996fb92427aE41E4"; // non-null placeholder

module.exports = function(E) {

  describe("admin management", function() {
    let cns;
    beforeEach(async function() {
      cns = await E.deployInit({ req: 1 });
    });

    async function test_cancel_outstanding_requests(funcName, args) {
      let cns = await E.deployInit({ req: 2 });
      // Submit ID 0, 1, 2
      await E.tx_submit(cns, E.admin1, 'AddAdmin', [E.other1.address]);
      await E.tx_submit(cns, E.admin1, funcName, args);
      await E.tx_submit(cns, E.admin1, 'AddAdmin', [E.other1.address]);

      // Execute ID 1
      await E.tx_confirm(cns, E.admin2, 1, funcName, args);

      // Cancels ID 0, 2
      await E.check_RequestState(cns, 0, 'Canceled');
      await E.check_RequestState(cns, 1, 'Executed');
      await E.check_RequestState(cns, 2, 'Canceled');
    }

    describe("AddAdmin", function() {
      it("success", async function() {
        await E.must_func(cns, E.admin1, 'AddAdmin', [E.other1.address], [E.other1.address]);

        expect(await cns.isAdmin(E.other1.address)).to.equal(true);
      });
      it("reject adding already-admin", async function() {
        await E.revert_func(cns, E.admin1, 'AddAdmin', [E.admin2.address], "Admin already exists.");
      });
      it("reject null address", async function() {
        await E.revert_func(cns, E.admin1, 'AddAdmin', [NULL_ADDR], "Address is null");
      });
      it("reject above max", async function() {
        await cns.mockSetMaxAdmin(4);
        await E.must_func(cns,   E.admin1, 'AddAdmin', [E.other1.address]);
        await E.revert_func(cns, E.admin1, 'AddAdmin', [E.other2.address], "Invalid requirement.");
      });
      it("cancel outstanding requests", async function() {
        await test_cancel_outstanding_requests('AddAdmin', [E.other1.address]);
      });
    }); // AddAdmin

    describe("DeleteAdmin", function() {
      it("success", async function() {
        await E.must_func(cns, E.admin1, 'DeleteAdmin', [E.admin2.address], [E.admin2.address]);

        expect(await cns.isAdmin(E.admin2.address)).to.equal(false);
      });
      it("reject deleting non-admin", async function() {
        await E.revert_func(cns, E.admin1, 'DeleteAdmin', [E.other1.address], "Address is not admin.");
      });
      it("reject null address", async function() {
        await E.revert_func(cns, E.admin1, 'DeleteAdmin', [NULL_ADDR], "Address is null");
      });
      it("reject below requirement", async function() {
        cns = await E.deployInit({ req: 3 });
        await E.revert_func(cns, E.admin1, 'DeleteAdmin', [E.admin2.address], "Invalid requirement.");
      });
      it("cancel outstanding requests", async function() {
        await test_cancel_outstanding_requests('DeleteAdmin', [E.admin3.address]);
      });
    }); // DeleteAdmin

    describe("UpdateRequirement", function() {
      it("success", async function() {
        await E.must_func(cns, E.admin1, 'UpdateRequirement', [3], [3]);

        expect(await cns.requirement()).to.equal(3);
      });
      it("reject above admin count", async function() {
        await E.revert_func(cns, E.admin1, 'UpdateRequirement', [4], "Invalid requirement.");
      });
      it("reject zero", async function() {
        await E.revert_func(cns, E.admin1, 'UpdateRequirement', [0], "Invalid requirement.");
      });
      it("reject noop", async function() {
        await E.revert_func(cns, E.admin1, 'UpdateRequirement', [1], "Invalid value");
      });
      it("cancel outstanding requests", async function() {
        await test_cancel_outstanding_requests('UpdateRequirement', [3]);
      });
    }); // UpdateRequirement

    describe("ClearRequest", function() {
      it("success", async function() {
        let cns = await E.deployInit({ req: 2 });

        // ID 0: Executed
        await E.tx_submit(cns, E.admin1, 'UpdateVoterAddress', [E.other1.address]);
        await E.tx_confirm(cns, E.admin2, 0, 'UpdateVoterAddress', [E.other1.address]);
        // ID 1: NotConfirmed
        await E.tx_submit(cns, E.admin1, 'UpdateVoterAddress', [E.other2.address]);
        // ID 2: Executed - cancels ID 1
        await E.tx_submit(cns, E.admin1, 'ClearRequest', []);
        await E.tx_confirm(cns, E.admin2, 2, 'ClearRequest', []);

        await E.check_RequestState(cns, 0, 'Executed');
        await E.check_RequestState(cns, 1, 'Canceled');
        await E.check_RequestState(cns, 2, 'Executed');
      });
    }); // ClearRequest
  });
}
