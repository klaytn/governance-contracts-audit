const _ = require("lodash");
const { expect } = require("chai");
const { constants } = require("@openzeppelin/test-helpers");
const { setBlock, toPeb, getBalance, numericAddr } = require("./helper.js");

const NULL_ADDR = constants.ZERO_ADDRESS;
const NA = numericAddr;
const [ NA01, NA02, NA09 ] = [ NA(0,1), NA(0,2), NA(0,9) ];
const [ NA11, NA19, NA21, NA29 ] = [ NA(1,1), NA(1,9), NA(2,1), NA(2,9) ];

module.exports = function(E) {

  describe("replace", function() {
    // Suppose one of the contracts has to be replaced for some reason.
    // It could be cricical bug fix, adding new feature, or controlling
    // accounts were lost.

    it("replace CnStakingV2", async function() {
      /// Replace V2 of a CN, transfer all stakes and retain voting ability.
      /// 1. Setup singleton contracts
      /// 2. Register the first (old) V2 to AB
      /// 3. Register the second (new) V2 to AB
      /// 4. Transfer stakes from the old to new V2.
      /// 5. The CN can successfully votes

      /// -- 1. Setup singleton contracts
      let [ abook, st, vo, gp ] = await E.singletonDeploy();
      let stAddr = st.address;
      let voAddr = vo.address;

      /// -- 2. Register the first (old) V2 to AB
      // Stake 5m KLAY, Appoint voter1
      let cnsOld = await E.cnsDeployV2(NA01, NA09, 1, stAddr);
      await abook.mockRegisterCnStakingContracts([NA01], [cnsOld.address], [NA09]);
      await E.cnsStake(cnsOld, toPeb(5000000));
      await E.cnsUpdateVoter(cnsOld, E.voter1.address);

      /// -- 3. Register the second (new) V2 to AB
      let cnsNew = await E.cnsDeployV2(NA02, NA09, 1, stAddr);
      await abook.mockRegisterCnStakingContracts([NA02], [cnsNew.address], [NA09]);

      /// -- 4. Transfer stakes from the old to new V2.
      await E.cnsApprove(cnsOld, cnsNew.address, toPeb(5000000));
      await E.cnsWithdraw(cnsOld, 0);
      expect(await getBalance(cnsOld.address)).to.equal(toPeb(1));
      expect(await getBalance(cnsNew.address)).to.equal(toPeb(5000001));

      /// -- 5. The CN can successfully votes
      await E.voteSetParam(vo, E.voter1, E.secr1, gp);
    });

    it("replace StakingTracker", async function() {
      /// Replace the singleton ST. For this operation, we have to update
      /// all stakingTracker addresses stored in CnSV2's and the Vo.
      /// 1. Setup singleton contracts
      /// 2. Register a V2 to AB
      /// 3. Deploy a new ST
      /// 4. Update Vo.stakingTracker through a proposal
      /// 5. Update CnSV2.stakingTracker
      /// 6. The CN successfully votes

      /// -- 1. Setup singleton contracts
      let [ abook, stOld, vo, gp ] = await E.singletonDeploy();
      let stOldAddr = stOld.address;
      let voAddr = vo.address;

      /// -- 2. Register a V2 to AB
      // Stake 5m KLAY, Appoint voter1
      let cns = await E.cnsDeployV2(NA01, NA09, 1, stOldAddr);
      await abook.mockRegisterCnStakingContracts([NA01], [cns.address], [NA09]);
      await E.cnsStake(cns, toPeb(5000000));
      await E.cnsUpdateVoter(cns, E.voter1.address);

      /// -- 3. Deploy a new ST
      let stNew = await E.STMock.connect(E.deployer).deploy();
      let stNewAddr = stOld.address;
      await stNew.mockSetAddressBookAddress(abook.address);

      /// -- 4. Update Vo.stakingTracker through a proposal
      // Use calldata = updateStakingTracker(address = stNewAddr)
      let calldata = "0x5be6eacc" + stNewAddr.substr(2).padStart(64,'0');
      await vo.connect(E.secr1).propose("Replace ST",
        [vo.address],
        [toPeb(0)],
        [calldata],
        86400, 86400);

      // Pass and queue the proposal
      var pid = await vo.lastProposalId();
      await E.queueProposal(vo, E.voter1, E.secr1, pid);

      // Execute the proposal
      await expect(vo.connect(E.secr1).execute(pid))
        .to.emit(vo, "UpdateStakingTracker").withArgs(stOldAddr, stNewAddr);
      expect(await vo.stakingTracker()).to.equal(stNewAddr);

      /// -- 5. Update CnSV2.stakingTracker
      await E.cnsUpdateStakingTracker(cns, stNewAddr);
      await stNew.refreshVoter(cns.address);

      /// -- 6. The CN successfully votes
      await E.voteSetParam(vo, E.voter1, E.secr1, gp);
    });
    it("replace Voting for upgrade", async function() {
      /// Replace the singleton Vo. For this operation, the old Vo must
      /// transfer ownership of some contracts to the new Vo.
      /// 1. Setup singleton contracts
      /// 2. Register a V2 to AB
      /// 3. Deploy a new Vo
      /// 4. {ST,GP}.transferOwnership through a proposal
      /// 5. The CN successfully votes

      /// -- 1. Setup singleton contracts
      let [ abook, st, voOld, gp ] = await E.singletonDeploy();
      let stAddr = st.address;
      let voOldAddr = voOld.address;

      /// -- 2. Register a V2 to AB
      // Stake 5m KLAY, Appoint voter1
      let cns = await E.cnsDeployV2(NA01, NA09, 1, stAddr);
      await abook.mockRegisterCnStakingContracts([NA01], [cns.address], [NA09]);
      await E.cnsStake(cns, toPeb(5000000));
      await E.cnsUpdateVoter(cns, E.voter1.address);

      /// -- 3. Deploy a new Vo
      let voNew = await E.Vo.connect(E.deployer).deploy(stAddr, E.secr1.address);
      let voNewAddr = voNew.address;

      /// -- 4. {ST,GP}.transferOwnership through a proposal
      // Use calldata = transferOwnership(address = voNewAddr)
      let calldata = "0xf2fde38b" + voNewAddr.substr(2).padStart(64,'0');
      await voOld.connect(E.secr1).propose("Transfer ownership of ST and GP",
        [st.address, gp.address],
        [toPeb(0), toPeb(0)],
        [calldata, calldata],
        86400, 86400);

      // Pass and queue the proposal
      var pid = await voOld.lastProposalId();
      await E.queueProposal(voOld, E.voter1, E.secr1, pid);

      // Execute the proposal
      await expect(voOld.connect(E.secr1).execute(pid))
        .to.emit(st, "OwnershipTransferred").withArgs(voOldAddr, voNewAddr)
        .to.emit(gp, "OwnershipTransferred").withArgs(voOldAddr, voNewAddr);
      expect(await st.owner()).to.equal(voNewAddr);
      expect(await gp.owner()).to.equal(voNewAddr);

      /// 5. The CN successfully votes
      await E.voteSetParam(voNew, E.voter1, E.secr1, gp);
    });
    it("replace Voting for secretary reset", async function() {
      /// Replace the singleton Vo. In this case, the secr1 account is
      /// unfortunately lost. We have to deploy another set of Vo, ST, GP.
      /// 1. Setup singleton contracts
      /// 2. Register a V2 to AB
      /// 3. Deploy new ST, Vo, GP
      /// 4. Update CnSV2.stakingTracker
      /// 5. The CN successfully votes

      /// -- 1. Setup singleton contracts
      let [ abook, stOld, voOld, gpOld ] = await E.singletonDeploy();

      /// -- 2. Register a V2 to AB
      // Stake 5m KLAY, Appoint voter1
      let cns = await E.cnsDeployV2(NA01, NA09, 1, stOld.address);
      await abook.mockRegisterCnStakingContracts([NA01], [cns.address], [NA09]);
      await E.cnsStake(cns, toPeb(5000000));
      await E.cnsUpdateVoter(cns, E.voter1.address);

      /// -- 3. Deploy new ST, Vo, GP
      // Since we lost secr1 account, we use secr2 instead.
      let stNew = await E.STMock.connect(E.deployer).deploy();
      await stNew.mockSetAddressBookAddress(abook.address);
      let gpNew = await E.GP.connect(E.deployer).deploy();

      let voNew = await E.Vo.connect(E.deployer).deploy(stNew.address, E.secr2.address);
      await stNew.connect(E.deployer).transferOwnership(voNew.address);
      await gpNew.connect(E.deployer).transferOwnership(voNew.address);

      /// -- 4. Update CnSV2.stakingTracker
      await E.cnsUpdateStakingTracker(cns, stNew.address);
      await stNew.refreshVoter(cns.address);

      /// -- 5. The CN successfully votes
      await E.voteSetParam(voNew, E.voter1, E.secr2, gpNew);
    });
    it("replace GovParam", async function() {
      /// Replace the singleton GP. This operation does not require interaction
      /// with other contracts.
      /// 1. Setup singleton contracts
      /// 2. Register a V2 to AB
      /// 3. Deploy new GP
      /// 4. The CN successfully votes

      /// -- 1. Setup singleton contracts
      let [ abook, st, vo, gpOld ] = await E.singletonDeploy();

      /// -- 2. Register a V2 to AB
      // Stake 5m KLAY, Appoint voter1
      let cns = await E.cnsDeployV2(NA01, NA09, 1, st.address);
      await abook.mockRegisterCnStakingContracts([NA01], [cns.address], [NA09]);
      await E.cnsStake(cns, toPeb(5000000));
      await E.cnsUpdateVoter(cns, E.voter1.address);

      /// -- 3. Deploy new GP
      let gpNew = await E.GP.connect(E.deployer).deploy();
      await gpNew.connect(E.deployer).transferOwnership(vo.address);

      /// -- 4. The CN successfully votes
      await E.voteSetParam(vo, E.voter1, E.secr1, gpNew);
    });
  });
}
