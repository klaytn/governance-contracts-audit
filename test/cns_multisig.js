const _ = require("lodash");
const { ethers } = require("hardhat");
const { expect } = require("chai");
const { constants } = require("@openzeppelin/test-helpers");
const { nowTime, addPebs, toBytes32, expectRevert } = require("./helper.js");

const NULL_ADDR = constants.ZERO_ADDRESS;
const RAND_ADDR = "0xe3B0C44298FC1C149AfBF4C8996fb92427aE41E4"; // non-null placeholder

module.exports = function(E) {

  describe("multisig", function() {

    describe("submit and confirm", function() {
      it("success 1 requirement", async function() {
        let cns = await E.deployInit({ req: 1 });
        await E.must_submitAddAdmin(cns, E.admin1, 'submit,confirm,success', [E.admin1]);
      });
      it("success 2 requirements", async function() {
        let cns = await E.deployInit({ req: 2 });
        await E.must_submitAddAdmin(cns,  E.admin1, 'submit,confirm',  [E.admin1]);
        await E.must_confirmAddAdmin(cns, E.admin2, 'confirm,success', [E.admin1, E.admin2]);
      });
      it("success 3 requirements", async function() {
        let cns = await E.deployInit({ req: 3 });
        await E.must_submitAddAdmin(cns,  E.admin1, 'submit,confirm',  [E.admin1]);
        await E.must_confirmAddAdmin(cns, E.admin2, 'confirm',         [E.admin1, E.admin2]);
        await E.must_confirmAddAdmin(cns, E.admin3, 'confirm,success', [E.admin1, E.admin2, E.admin3]);
      });
      it("reject non-admin submit", async function() {
        let cns = await E.deployInit({ req: 1 });
        await E.revert_submitAddAdmin(cns, E.other2, "Address is not admin.");
      });
      it("reject non-admin confirm", async function() {
        let cns = await E.deployInit({ req: 2 });
        await E.must_submitAddAdmin(cns,    E.admin1, 'submit,confirm', [E.admin1]);
        await E.revert_confirmAddAdmin(cns, E.other2, "Address is not admin.");
      });
      it("reject duplicate confirms", async function() {
        let cns = await E.deployInit({ req: 2 });
        await E.must_submitAddAdmin(cns,    E.admin1, 'submit,confirm', [E.admin1]);
        await E.revert_confirmAddAdmin(cns, E.admin1, "Msg.sender already confirmed.");
      });
      it("reject confirm after execute", async function() {
        let cns = await E.deployInit({ req: 1 });
        await E.must_submitAddAdmin(cns,    E.admin1, 'submit,confirm,success', [E.admin1]);
        await E.revert_confirmAddAdmin(cns, E.admin2, "Must be at not-confirmed state.");
      });
      it("reject unknown id", async function() {
        let cns = await E.deployInit({ req: 2 });
        await expectRevert(E.tx_confirm(cns, E.admin1, 999, 'AddAdmin', [RAND_ADDR]), "Must be at not-confirmed state.");
      });
      it("reject arguments mismatch", async function() {
        let cns = await E.deployInit({ req: 3 });
        let msg = "Function id and arguments do not match.";

        await E.must_submitAddAdmin(cns, E.admin1, 'submit,confirm', [E.admin1]);

        await expectRevert(E.tx_confirm(cns, E.admin3, 0, 'DeleteAdmin', [E.other1.address, 0,    0]),     msg);
        await expectRevert(E.tx_confirm(cns, E.admin3, 0, 'AddAdmin',    [RAND_ADDR,        0,    0]),     msg);
        await expectRevert(E.tx_confirm(cns, E.admin3, 0, 'AddAdmin',    [E.other1.address, 2222, 0]),     msg);
        await expectRevert(E.tx_confirm(cns, E.admin3, 0, 'AddAdmin',    [E.other1.address, 0,    33333]), msg);
      });
    }); // submit and confirm

    describe("revoke", function() {
      it("revoke by proposer", async function() {
        let cns = await E.deployInit({ req: 2 });
        await E.must_submitAddAdmin(cns,    E.admin1, 'submit,confirm', [E.admin1]);
        await E.must_revokeAddAdmin(cns,    E.admin1, 'cancel',         [E.admin1]);
        await E.revert_confirmAddAdmin(cns, E.admin2, "Must be at not-confirmed state.");
      });
      it("revoke by non-proposer", async function() {
        let cns = await E.deployInit({ req: 3 });
        await E.must_submitAddAdmin(cns,  E.admin1, 'submit,confirm',  [E.admin1]);
        await E.must_confirmAddAdmin(cns, E.admin2, 'confirm',         [E.admin1, E.admin2]);
        await E.must_revokeAddAdmin(cns,  E.admin2, 'revoke',          [E.admin1]);
        await E.must_confirmAddAdmin(cns, E.admin3, 'confirm',         [E.admin1, E.admin3]);
        await E.must_confirmAddAdmin(cns, E.admin2, 'confirm,success', [E.admin1, E.admin3, E.admin2]);
      });
      it("reject non-admin revoke", async function() {
        let cns = await E.deployInit({ req: 2 });
        await E.must_submitAddAdmin(cns,   E.admin1, 'submit,confirm', [E.admin1]);
        await E.revert_revokeAddAdmin(cns, E.other2, "Address is not admin.");
      });
      it("reject non-confirmer revoke", async function() {
        let cns = await E.deployInit({ req: 3 });
        await E.must_submitAddAdmin(cns,   E.admin1, 'submit,confirm', [E.admin1]);
        await E.revert_revokeAddAdmin(cns, E.admin2, "Msg.sender has not confirmed.");
      });
      it("reject duplicate revokes by proposer", async function() {
        let cns = await E.deployInit({ req: 3 });
        await E.must_submitAddAdmin(cns,   E.admin1, 'submit,confirm', [E.admin1]);
        await E.must_revokeAddAdmin(cns,   E.admin1, 'cancel',         []);
        await E.revert_revokeAddAdmin(cns, E.admin1, "Must be at not-confirmed state.");
      });
      it("reject duplicate revokes by proposer", async function() {
        let cns = await E.deployInit({ req: 3 });
        await E.must_submitAddAdmin(cns,   E.admin1, 'submit,confirm', [E.admin1]);
        await E.must_confirmAddAdmin(cns,  E.admin2, 'confirm',        [E.admin1, E.admin2]);
        await E.must_revokeAddAdmin(cns,   E.admin2, 'revoke',         []);
        await E.revert_revokeAddAdmin(cns, E.admin2, "Msg.sender has not confirmed.");
      });
      it("reject revoke by proposer after execute", async function() {
        let cns = await E.deployInit({ req: 1 });
        await E.must_submitAddAdmin(cns, E.admin1, 'submit,confirm,success', [E.admin1]);
        await E.revert_revokeAddAdmin(cns, E.admin1, "Must be at not-confirmed state.");
      });
      it("reject revoke by non-proposer after execute", async function() {
        let cns = await E.deployInit({ req: 2 });
        await E.must_submitAddAdmin(cns,   E.admin1, 'submit,confirm',  [E.admin1]);
        await E.must_confirmAddAdmin(cns,  E.admin2, 'confirm,success', [E.admin1, E.admin2]);
        await E.revert_revokeAddAdmin(cns, E.admin2, "Must be at not-confirmed state.");
      });
      it("reject arguments mismatch", async function() {
        let cns = await E.deployInit({ req: 2 });
        let msg = "Function id and arguments do not match.";
        await E.must_submitAddAdmin(cns, E.admin1, 'submit,confirm', [E.admin1]);

        await expectRevert(E.tx_revoke(cns, E.admin1, 0, 'DeleteAdmin', [E.other1.address, 0,    0]),     msg);
        await expectRevert(E.tx_revoke(cns, E.admin1, 0, 'AddAdmin',    [RAND_ADDR,        0,    0]),     msg);
        await expectRevert(E.tx_revoke(cns, E.admin1, 0, 'AddAdmin',    [E.other1.address, 2222, 0]),     msg);
        await expectRevert(E.tx_revoke(cns, E.admin1, 0, 'AddAdmin',    [E.other1.address, 0,    33333]), msg);
      });
    }); // revoke

    describe("common preconditions", function() {
      // Run common tests for all multisig functions
      it("reject before init", async function() {
        let cns = await E.deploy({ req: 1 });
        for (var funcName of E.FuncNames) {
          var args = E.sampleArgs(funcName);
          await E.revert_func(cns, E.admin1, funcName, args, "Contract is not initialized.");
        }
      });
      it("reject call from non-admin", async function() {
        let cns = await E.deployInit({ req: 1 });
        for (var funcName of E.FuncNames) {
          var args = E.sampleArgs(funcName);
          await E.revert_func(cns, E.other1, funcName, args, "Address is not admin.");
        }
      });
      it("reject non-multisig direct call", async function() {
        let cns = await E.deployInit({ req: 1 });
        for (var funcName of E.FuncNames) {
          var args = E.sampleArgs(funcName);
          var contractFuncName = _.camelCase(funcName);
          var tx = cns.connect(E.admin1)[contractFuncName](...args);
          await expectRevert(tx, "Not a multisig-transaction.");
        }
      });
    }); // common preconditions

    describe("getRequestIds", function() {
      function tx_func(cns) { // Execute any function
        return E.tx_submit(cns, E.admin1, 'UpdateVoterAddress', [RAND_ADDR]);
      }
      async function check_ids(cns, from, to, state, expected) {
        expect(await cns.getRequestIds(from, to, state))
          .to.equalNumberList(expected);
      }

      it("search range", async function() {
        let cns = await E.deployInit({ req: 1 });
        await tx_func(cns);
        await tx_func(cns);
        await tx_func(cns);
        await tx_func(cns);
        let state = E.RequestState.Executed;

        // getRequestIds(from, to, state) searches in the range:
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
        let cns = await E.deployInit({ req: 2 });

        // ID 0 = Executed
        await E.must_submitAddAdmin(cns, E.admin1);
        await E.must_confirmAddAdmin(cns, E.admin2, 'success');
        // ID 1 = NotConfirmed
        await tx_func(cns);

        await check_ids(cns, 0, 0, E.RequestState.Executed,     [0]);
        await check_ids(cns, 0, 0, E.RequestState.NotConfirmed, [1]);
        await check_ids(cns, 0, 0, E.RequestState.Canceled,     []);
      });
    }); // getRequestIds

    describe("getRequestInfo", function() {
      it("success", async function() {
        let cns = await E.deployInit({ req: 1 });
        await E.must_submitAddAdmin(cns, E.admin1);

        let info = await cns.getRequestInfo(0);
        expect(info[0]).to.equal(E.FuncID.AddAdmin);           // funcID
        expect(info[1]).to.equal(toBytes32(E.other1.address)); // firstArg
        expect(info[2]).to.equal(toBytes32(0));                // secondArg
        expect(info[3]).to.equal(toBytes32(0));                // thirdArg
        expect(info[4]).to.equal(E.admin1.address);            // proposer
        expect(info[5]).to.equalAddrList([E.admin1.address]);  // confirmers
        expect(info[6]).to.equal(E.RequestState.Executed);     // state
      });
    }); // getRequestInfo

  });
}
