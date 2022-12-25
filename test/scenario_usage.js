const _ = require("lodash");
const { expect } = require("chai");
const { constants } = require("@openzeppelin/test-helpers");
const { setBlock, toPeb, getBalance, numericAddr } = require("./helper.js");

const NULL_ADDR = constants.ZERO_ADDRESS;
const NA = numericAddr;
const [ NA01, NA02, NA09 ] = [ NA(0,1), NA(0,2), NA(0,9) ];
const [ NA11, NA19, NA21, NA29 ] = [ NA(1,1), NA(1,9), NA(2,1), NA(2,9) ];

module.exports = function(E) {

  describe("usage", function() {

    it("migrate to CnStakingV2", async function() {
      /// Simulate the CnStaking migration process which CNs will go through.
      /// 1. Setup singleton contract AB
      /// 2. Register a V1 to AB
      /// 3. Setup singleton contract ST
      /// 4. Register a V2 to AB
      /// 5. Transfer stakes from V1 to V2

      /// -- 1. Setup singleton contract AB
      let abook = await E.ABook.deploy();
      await abook.constructContract([], 0);

      /// -- 2. Register a V1 to AB
      let cnsv1 = await E.cnsDeployV1(NA01, NA09);
      await abook.mockRegisterCnStakingContracts([NA01], [cnsv1.address], [NA09]);
      await E.cnsStake(cnsv1, toPeb(5000000));

      /// -- 3. Setup singleton contracts ST, Vo
      // Auto-deploy ST by Vo.constructor()
      let vo = await E.Vo.connect(E.deployer).deploy(NULL_ADDR, E.secr1.address);
      let stAddr = await vo.stakingTracker();

      /// -- 4. Register a V2 to AB
      let cnsv2 = await E.cnsDeployV2(NA02, NA09, stAddr);
      await abook.mockRegisterCnStakingContracts([NA02], [cnsv2.address], [NA09]);

      /// -- 5. Transfer stakes from V1 to V2
      // Because V1 uses .transfer() to withdraw funds, it cannot directly transfer to V2.
      // We must withdraw into an EOA first, then stake to cnsv2.
      await E.cnsApprove(cnsv1, E.deployer.address, toPeb(5000000));
      await E.cnsWithdraw(cnsv1, 0);
      await E.cnsStake(cnsv2, toPeb(5000000));
      expect(await getBalance(cnsv1.address)).to.equal(toPeb(1));
      expect(await getBalance(cnsv2.address)).to.equal(toPeb(5000001));
    });

    it("three CNs change stakes and voter address after proposal", async function() {
      /// Overview
      /// 1. Setup singleton contracts
      /// 2. Setup CN staking contracts
      /// 3. The secretary submits a proposal
      /// 4. CNs change stakes before voteStart
      /// 5. CNs change voter address after voteStart
      /// 6. All CNs successfully cast votes

      /// -- 1. Setup singleton contracts
      let [ abook, st, vo, gp ] = await E.singletonDeploy();
      let stAddr = st.address;

      /// -- 2. Setup CN staking contracts
      let cns1 = await E.cnsDeployV2(NA01, NA09, stAddr); // CN1
      let cns2 = await E.cnsDeployV2(NA11, NA19, stAddr); // CN2
      let cns3 = await E.cnsDeployV2(NA21, NA29, stAddr); // CN3
      await abook.mockRegisterCnStakingContracts(
        [NA01, NA11, NA21], [cns1.address, cns2.address, cns3.address], [NA09, NA19, NA29]);

      // Each CN stakes some amount and appoint their voter accounts.
      await E.cnsStake(cns1, toPeb(5e6));  // 1 vote
      await E.cnsStake(cns2, toPeb(7e6));  // 1 vote
      await E.cnsStake(cns3, toPeb(10e6)); // 2 votes

      await E.cnsUpdateVoter(cns1, E.voter1.address);
      await E.cnsUpdateVoter(cns2, E.voter2.address);
      await E.cnsUpdateVoter(cns3, E.voter3.address);

      /// -- 3. The secretary submits a proposal
      await vo.connect(E.secr1).propose("asdf", [], [], [], 86400, 86400);
      let pid = await vo.lastProposalId();

      /// -- 4. CNs change stakes before voteStart
      // CN1 effective balance 5m -> 20m. now 2 votes (capped to 2)
      await E.cnsStake(cns1, toPeb(15e6));
      expect(await cns1.staking()).to.equal(toPeb(20e6));

      // CN3 effective balance 10m -> 7m. now 1 vote
      await E.cnsApprove(cns3, E.admin3.address, toPeb(3e6));
      expect(await cns3.staking()).to.equal(toPeb(10e6));          // staking unchanged
      expect(await cns3.unstaking()).to.equal(toPeb(3e6));         // unstaking += amt

      /// -- 5. CNs change voter address after voteStart
      let { voteStart } = await vo.getProposalSchedule(pid);
      await setBlock(voteStart);

      // CN2 change voter address voter2 -> voter4
      await E.cnsUpdateVoter(cns2, E.voter4.address);

      /// -- 6. All CNs successfully cast votes
      let [ No, Yes, Abstain ] = [0,1,2];
      await vo.connect(E.voter1).castVote(pid, Yes);
      await vo.connect(E.voter4).castVote(pid, No); // using the new voter address
      await vo.connect(E.voter3).castVote(pid, Abstain);

      let { totalYes, totalNo, totalAbstain } = await vo.getProposalTally(pid);
      expect(totalYes).to.equal(2);
      expect(totalNo).to.equal(1);
      expect(totalAbstain).to.equal(1);
    });
  });
}
