/*
const {expect, Assertion} = require("chai");
const {ethers, upgrades} = require("hardhat");
const _ = require("lodash");
const {nowTime, setTime, getBalance, toPeb, toKlay, addPebs, subPebs,
       toBytes32, augmentChai} = require("./helper.js");

augmentChai();

const NULL_ADDR = "0x0000000000000000000000000000000000000000";
const RAND_ADDR = "0xe3B0C44298FC1C149AfBF4C8996fb92427aE41E4" // A non-null placeholder

const FuncID = {
    Unknown: 0,
    AddAdmin: 1,
    DeleteAdmin: 2,
    UpdateRequirement: 3,
    ClearRequest: 4,
    ActivateAddressBook: 5,
    UpdatePocContract: 6,
    UpdateKirContract: 7,
    RegisterCnStakingContract: 8,
    UnregisterCnStakingContract: 9,
    UpdateSpareContract: 10,
};
const RequestState = {
    Unknown: 0,
    NotConfirmed: 1,
    Executed: 2,
    ExecutionFailed: 3,
    Expired: 4,
};

describe("AddressBook", function() {
    let accounts;
    let admin1, admin2, admin3, admin4, admin5, cnAdmin1;
    let nodeId, rewardAddr;

    let AddressBook, CnStakingV2, KlaytnReward;

    before(async function () {
        accounts = await hre.ethers.getSigners();
        cnAdmin1 = accounts[0];
        admin1 = accounts[1];
        admin2 = accounts[2];
        admin3 = accounts[3];
        admin4 = accounts[4];
        admin5 = accounts[5];
        nodeId = accounts[6].address;
        rewardAddr = accounts[7].address;

        AddressBook = await ethers.getContractFactory("AddressBook");
        CnStakingV2 = await ethers.getContractFactory("CnStakingV2Mock");
        KlaytnReward = await ethers.getContractFactory("KlaytnReward");
    });

    async function initCnStaking(opts) {
        opts            = opts            || {};
        opts.nodeId     = opts.nodeId     || nodeId;
        opts.rewardAddr = opts.rewardAddr || rewardAddr;

        let t1 = (await nowTime()) + 10;
        let cns = await CnStakingV2.connect(admin1).deploy(
            admin1.address, opts.nodeId, opts.rewardAddr,
            [cnAdmin1.address], 1,
            [t1], [toPeb(1)]);
        await cns.connect(admin1).reviewInitialConditions();
        await cns.connect(cnAdmin1).reviewInitialConditions();
        await cns.connect(cnAdmin1).depositLockupStakingAndInit({ value: toPeb(1) });
        return cns;
    }

    describe("RegisterCnStaking", function() {
        describe("regress-2022-11", function() {
            let existing_cns, new_cns, poc, kir, abook;
            before(async function() {
                existing_cns = await initCnStaking({ nodeId: RAND_ADDR, rewardAddr: RAND_ADDR });
                new_cns = await initCnStaking({ nodeId: nodeId, rewardAddr: rewardAddr });
                poc = await KlaytnReward.deploy();
                kir = await KlaytnReward.deploy();

                abook = await AddressBook.deploy();
                await abook.constructContract(
                    [admin1.address, admin2.address, admin3.address, admin4.address, admin5.address],
                    1);
                await abook.connect(admin1).submitUpdatePocContract(poc.address, 1);
                await abook.connect(admin1).submitUpdateKirContract(kir.address, 1);
                await abook.connect(admin1).submitRegisterCnStakingContract(RAND_ADDR, existing_cns.address, RAND_ADDR);
                await abook.connect(admin1).submitActivateAddressBook();
                await abook.connect(admin1).submitUpdateRequirement(3);
            });

            async function submitRegister(sender) {
                return abook.connect(sender).submitRegisterCnStakingContract(nodeId, new_cns.address, rewardAddr);
            }
            async function submitUnregister(sender) {
                return abook.connect(sender).submitUnregisterCnStakingContract(nodeId);
            }
            async function submitClear(sender) {
                return abook.connect(sender).submitClearRequest();
            }

            it("reenact", async function() {
                // Reenact the series of TXs on cypress address book in 2022-11.
                // T-N   AddressBook is activated with nonzero number of CNs.
                // T+0   register(admin4) by 0x22b9..
                // T+13d - at this point the request is expired
                //       register(admin1) by 0xd5ae..
                //       register(admin4)
                //       register(admin5) by 0xea61..
                //       unregister(admin4) reverts
                //       unregister(admin4) reverts
                //       register(admin4)
                //       - new_cns is not registered, and there is one pending request.
                let t0 = await nowTime();
                await submitRegister(admin4);

                await setTime(t0 + 86400 * 13); // set time T0+13d
                await expect(submitRegister(admin1)).to.emit(abook, "ExpiredRequest");
                await expect(submitRegister(admin4)).to.emit(abook, "ExpiredRequest");
                await expect(submitRegister(admin5)).to.emit(abook, "ExpiredRequest");
                await expect(submitUnregister(admin4)).to.be.revertedWith("Invalid CN node ID.");
                await expect(submitUnregister(admin4)).to.be.revertedWith("Invalid CN node ID.");

                // check that there is one expired request
                var reqs = await abook.getPendingRequestList();
                var req = await abook.getRequestInfo(reqs[0]);
                expect(reqs.length).to.equal(1);
                expect(req[0]).to.equal(FuncID.RegisterCnStakingContract);
                expect(req[1]).to.equal(toBytes32(nodeId));
                expect(req[2]).to.equal(toBytes32(new_cns.address));
                expect(req[3]).to.equal(toBytes32(rewardAddr));
                expect(req[4]).to.equalAddrList([ admin4 ]);
                expect(req[5]).to.equal(t0 + 1);
                expect(req[6]).to.equal(RequestState.Expired);

                // Simulate the discretionary measure to register new_cns.
                // T+19d - was in the future when writing this test
                //       register(admin1)
                //       register(admin4)
                //       register(admin5)
                //       - Now new_cns must have been registered, and there is no pending request.
                await setTime(t0 + 86400 * 19); // set time T0+19d
                await expect(submitRegister(admin1)).to.emit(abook, "SubmitRequest");
                await expect(submitRegister(admin4)).to.emit(abook, "SubmitRequest");
                await expect(submitRegister(admin5)).to.emit(abook, "SubmitRequest")
                    .to.emit(abook, "RegisterCnStakingContract");

                var reqs = await abook.getPendingRequestList();
                expect(reqs.length).to.equal(0);
                var cninfo = await abook.getCnInfo(nodeId);
                expect(cninfo[0]).to.equal(nodeId);
                expect(cninfo[1]).to.equal(new_cns.address);
                expect(cninfo[2]).to.equal(rewardAddr);
            });
        });
    });

});
*/
