const _ = require("lodash");
const { ethers } = require("hardhat");
const { expect } = require("chai");
const { constants } = require("@openzeppelin/test-helpers");
const { nowBlock, setBlock, toPeb, getBalance, expectRevert } = require("./helper.js");

const NULL_ADDR = constants.ZERO_ADDRESS;
const RAND_ADDR = "0xe3B0C44298FC1C149AfBF4C8996fb92427aE41E4"; // non-null placeholder

module.exports = function(E) {

  describe("StakingTracker", function() {
    let vo;
    beforeEach(async function() {
      vo = await E.deploy();
    });

    it("success by proposal", async function() {
      await E.must_updateStakingTracker(vo, null, E.other1.address);
    });
    it("reject null address", async function() {
      await E.revert_updateStakingTracker(vo, null, NULL_ADDR, "Address is null");
    });
    it("reject direct call", async function() {
      await E.revert_updateStakingTracker(vo, E.secr1, E.other1.address,
        "Not a governance transaction");
    });
    it("reject when there is an active tracker", async function() {
      // live tracker is created by proposing
      await E.must_propose(vo, E.secr1, {votingDelay: 28*86400});
      await E.revert_updateStakingTracker(vo, null, E.other1.address, "Cannot update tracker when there is an active tracker");
    });
  }); // StakingTracker

  describe("Secretary", function() {
    let vo;
    before(async function() {
      vo = await E.deploy();
    });

    it("success by proposal", async function() {
      await E.must_updateSecretary(vo, null, E.secr2.address);
    });
    it("reject direct call", async function() {
      await E.revert_updateSecretary(vo, E.secr1, E.secr2.address,
        "Not a governance transaction");
    });
  }); // Secretary

  describe("AccessRule", function() {
    let vo;
    let T = true, F = false;
    let answers_sv, answers_s, answers_v;
    beforeEach(async function() {
      vo = await E.deploy(E.conf5cn);

      // Under differnt AccessRule, expected outcomes of a function call from:
      // - E.secr1   the secretary
      // - E.voter1  an eligible voter (with 1 or more votes)
      // - E.voter5  an ineligible voter (with 0 votes)
      // - E.other1  any other account
      answers_sv = [ // if (sA && vA)
          [E.secr1,  true],
          [E.voter1, true],
          [E.voter5, false, "Not eligible to vote"],
          [E.other1, false, "Not a registered voter"]
      ];
      answers_s = [ // if (sA && !vA)
          [E.secr1,  true],
          [E.voter1, false, "Not the secretary"],
          [E.voter5, false, "Not the secretary"],
          [E.other1, false, "Not the secretary"]
      ];
      answers_v = [ // if (!sA && vA)
          [E.secr1,  false, "Not a registered voter"],
          [E.voter1, true],
          [E.voter5, false, "Not eligible to vote"],
          [E.other1, false, "Not a registered voter"]
      ];
    });

    describe("updateAccessRule", function() {

      it("success by proposal", async function() {
        await E.must_updateAccessRule(vo, null, [T,T,T,T]);
      });
      it("success secretary direct call", async function() {
        await E.must_updateAccessRule(vo, E.secr1, [T,F,T,F]);
      });
      it("reject non-secretary direct call", async function() {
        await E.revert_updateAccessRule(vo, E.other1, [T,T,T,T],
          "Not a governance transaction or secretary");
      });
      it("reject invalid rule", async function() {
        await E.revert_updateAccessRule(vo, E.secr1, [F,F,T,T], "No propose access");
        await E.revert_updateAccessRule(vo, E.secr1, [T,T,F,F], "No execute access");
      });
      it("cannot set secretary null", async function() {
        await E.must_updateAccessRule(vo, E.secr1, [T,F,T,T]);
        await E.revert_updateSecretary(vo, null, NULL_ADDR, "No propose access");

        await E.must_updateAccessRule(vo, E.secr1, [T,T,T,F]);
        await E.revert_updateSecretary(vo, null, NULL_ADDR, "No execute access");
      });
    }); // updateAccessRule

    describe("checkProposeAccess", function() {
      async function check_propose_access(vo, answers) {
        for (var answer of answers) {
          let [sender, ok, revertMsg] = answer;

          if (ok) {
            await E.must_propose(vo, sender, {});
          } else {
            await E.revert_propose(vo, sender, {}, revertMsg);
          }
        }
      }
      it("propose", async function() {
        await E.must_updateAccessRule(vo, E.secr1, [T,T,T,T]);
        await check_propose_access(vo, answers_sv);

        await E.must_updateAccessRule(vo, E.secr1, [T,F,T,T]);
        await check_propose_access(vo, answers_s);

        await E.must_updateAccessRule(vo, E.secr1, [F,T,T,T]);
        await check_propose_access(vo, answers_v);
      });
    }); // checkProposeAccess

    describe("checkExecuteAccess", function() {
      async function check_queue_access(vo, answers) {
        for (var answer of answers) {
          let [sender, ok, revertMsg] = answer;

          let pid = await E.createProposalAt(vo, 'Passed');
          if (ok) {
            await E.must_queue(vo, sender, pid);
          } else {
            await E.revert_queue(vo, sender, pid, revertMsg);
          }
        }
      }
      async function check_execute_access(vo, answers) {
        for (var answer of answers) {
          let [sender, ok, revertMsg] = answer;

          // Make pid at Queued state.
          // Since this test modifies the AccessRule, queue()
          // must be called by respective sender.
          let pid = await E.createProposalAt(vo, 'Passed');
          if ((await vo.accessRule())[2]) {
            await E.must_queue(vo, E.secr1, pid);
          } else {
            await E.must_queue(vo, E.voter1, pid);
          }
          await E.wait_eta(vo, pid);

          // Actual test against execute() function.
          if (ok) {
            await E.must_execute(vo, sender, pid, 0);
          } else {
            await E.revert_execute(vo, sender, pid, 0, revertMsg);
          }
        }
      }
      it("queue and execute", async function() {
        await E.must_updateAccessRule(vo, E.secr1, [T,T,T,T]);
        await check_queue_access(vo, answers_sv);
        await check_execute_access(vo, answers_sv);

        await E.must_updateAccessRule(vo, E.secr1, [T,T,T,F]);
        await check_queue_access(vo, answers_s);
        await check_execute_access(vo, answers_s);

        await E.must_updateAccessRule(vo, E.secr1, [T,T,F,T]);
        await check_queue_access(vo, answers_v);
        await check_execute_access(vo, answers_v);
      });
    }); // checkExecuteAccess
  }); // AccessRule

  describe("TimingRule", function() {
    let vo;
    let DAY = 86400;
    let sampleRule = [7*DAY, 14*DAY, 7*DAY, 14*DAY];
    before(async function() {
      vo = await E.deploy();
    });

    describe("updateTimingRule", function() {
      it("success by proposal", async function() {
        await E.must_updateTimingRule(vo, null, sampleRule);
      });
      it("success secretary direct call", async function() {
        await E.must_updateTimingRule(vo, E.secr1, sampleRule);
      });
      it("reject non-secretary direct call", async function() {
        await E.revert_updateTimingRule(vo, E.other1, sampleRule,
          "Not a governance transaction or secretary");
      });
      it("reject invalid rule", async function() {
        let msg = "Invalid timing";
        // require min > 0
        await E.revert_updateTimingRule(vo, E.secr1, [0,1,1,1], msg);
        await E.revert_updateTimingRule(vo, E.secr1, [1,1,0,1], msg);
        // require min <= max
        await E.revert_updateTimingRule(vo, E.secr1, [7,1,1,1], msg);
        await E.revert_updateTimingRule(vo, E.secr1, [1,1,7,1], msg);
      });
    }); // updateTimingRule
  }); // TimingRule
}
