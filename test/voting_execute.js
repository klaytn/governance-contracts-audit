const _ = require("lodash");
const { expect } = require("chai");
const { nowBlock, setBlock, toPeb, getBalance, expectRevert } = require("./helper.js");

module.exports = function(E) {

  describe("queue", function() {
    let vo;
    before(async function() {
      vo = await E.deploy();
    });

    describe("access control", function() {
      it("success secretary", async function() {
        let pid = await E.createProposalAt(vo, 'Passed');
        await E.must_queue(vo, E.secr1, pid);
      });
      it("reject non-secretary under SE", async function() {
        let pid = await E.createProposalAt(vo, 'Passed');
        await E.revert_queue(vo, E.voter1, pid, "Not the secretary");
        await E.revert_queue(vo, E.other1, pid, "Not the secretary");
      });
    }); // access control

    describe("validation", function() {
      it("reject unknown id", async function() {
        await E.revert_queue(vo, E.secr1, 99, "No such proposal");
      });
      it("reject zero actions", async function() {
        let pid = await E.createProposalAt(vo, 'Passed', E.zeroActions);
        await E.revert_queue(vo, E.secr1, pid, "Proposal has no action");
      });

      it("expires after queueDeadline", async function() {
        let pid = await E.createProposalAt(vo, 'Passed');
        await E.wait_queueDeadline(vo, pid);
        await E.check_state(vo, pid, 'Expired');
      });
      it("does not expire with zero actions", async function() {
        let pid = await E.createProposalAt(vo, 'Passed', E.zeroActions);
        await E.wait_queueDeadline(vo, pid);
        await E.check_state(vo, pid, 'Passed');
      });
    }); // validation
  }); // queue

  describe("execute", function() {
    let vo;
    before(async function() {
      vo = await E.deploy();
    });

    describe("access control", function() {
      it("success secretary", async function() {
        let pid = await E.createProposalAt(vo, 'Queued');
        await E.wait_eta(vo, pid);
        await E.must_execute(vo, E.secr1, pid);
      });
      it("reject non-secretary under SE", async function() {
        let pid = await E.createProposalAt(vo, 'Queued');
        await E.wait_eta(vo, pid);
        await E.revert_execute(vo, E.voter1, pid, 0, "Not the secretary");
        await E.revert_execute(vo, E.other1, pid, 0, "Not the secretary");
      });
    }); // access control

    describe("validation", function() {
      it("reject unknown id", async function() {
        await E.revert_execute(vo, E.secr1, 99, 0, "No such proposal");
      });

      it("reject before execDelay", async function() {
        let pid = await E.createProposalAt(vo, 'Queued');
        await E.revert_execute(vo, E.secr1, pid, 0, "Not yet executable");
      });
      it("expires after execDeadline", async function() {
        let pid = await E.createProposalAt(vo, 'Queued');
        await E.wait_execDeadline(vo, pid);
        await E.check_state(vo, pid, 'Expired');
        await E.revert_execute(vo, E.secr1, pid, 0, "Not allowed in current state");
      });
    }); // validation

    describe("tx handling", function() {
      let recipient;
      before(async function() {
        let Recipient = await ethers.getContractFactory("DenyingRecipient");
        recipient = await Recipient.deploy();
      });

      it("success retry", async function() {
        let pid = await E.createProposalAt(vo, 'Queued', { values: [toPeb(100)] });
        await E.wait_eta(vo, pid);

        // Fails with not enough balance
        await E.revert_execute(vo, E.secr1, pid, toPeb(99), "Transaction failed");

        // Retry succeeds
        await E.must_execute(vo, E.secr1, pid, toPeb(100));
      });
      it("success exceesive balance", async function() {
        // First proposal dictates to pay 100 KLAY.
        var pid = await E.createProposalAt(vo, 'Queued', { values: [toPeb(100)] });
        await E.wait_eta(vo, pid);
        // The secretary mistakenly sent 150 KLAY.
        await E.must_execute(vo, E.secr1, pid, toPeb(150));
        // The Voting contract now has 50 KLAY.
        var balance = await getBalance(vo.address);
        expect(balance).to.equals(toPeb(50));

        // Second proposal takes out the remaining balance
        var pid = await E.createProposalAt(vo, 'Queued', { values: [toPeb(50)] });
        await E.wait_eta(vo, pid);
        // This time, the secretary doesn't have to send KLAY.
        await E.must_execute(vo, E.secr1, pid, toPeb(0));
        // The Voting contract is now empty.
        var balance = await getBalance(vo.address);
        expect(balance).to.equals(toPeb(0));
      });
      it("revert without message", async function() {
        var pid = await E.createProposalAt(vo, 'Queued', {
          targets: [recipient.address], values: [0], calldatas: ["0x12345678"] });
        await E.wait_eta(vo, pid);

        // No such function signature '0x12345678'
        await E.revert_execute(vo, E.secr1, pid, 0, "Transaction failed");
      });
      it("revert with message", async function() {
        var pid = await E.createProposalAt(vo, 'Queued', {
          targets: [recipient.address], values: [0], calldatas: ["0xd0e30db0"] });
        await E.wait_eta(vo, pid);

        // DenyingRecipient.deposit() (4bytes: 0xd0e30db0) always reverts.
        // Revert message from the target must bubble up
        await E.revert_execute(vo, E.secr1, pid, 0, "You cannot deposit");
      });
    }); // tx handling
  }); // execute
}
