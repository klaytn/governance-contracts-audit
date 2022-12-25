/*
const {expect} = require("chai");
const {ethers, upgrades} = require("hardhat");
const _ = require("lodash");

describe("AddressBookMock", function () {
    let ab, accounts;
    beforeEach(async function () {
        accounts = await hre.ethers.getSigners();
        const Abook = await ethers.getContractFactory("AddressBookMock");
        ab = await Abook.deploy();
        await ab.constructContract([], 0);
        const addr = accounts[0].address;
        await ab.updatePocContract(addr, 0);
        await ab.updateKirContract(addr, 0);
    });

    describe("registerCnStakingContract", function () {
        it("registerCnStakingContract success", async function () {
            const addr = accounts[0].address;
            await ab.registerCnStakingContract(addr, addr, addr);
            await ab.activateAddressBook();
            var addresses = await ab.getAllAddressInfo();
            expect(addresses[0]).to.deep.equal([addr]);
            expect(addresses[1]).to.deep.equal([addr]);
            expect(addresses[2]).to.deep.equal([addr]);

            const addr2 = accounts[1].address;
            await ab.registerCnStakingContract(addr2, addr2, addr2);
            addresses = await ab.getAllAddressInfo();
            expect(addresses[0]).to.deep.equal([addr, addr2]);
            expect(addresses[1]).to.deep.equal([addr, addr2]);
            expect(addresses[2]).to.deep.equal([addr, addr2]);
        });

        it("submitRegisterCnStakingContract success", async function () {
            const addr = accounts[0].address;
            await ab.submitRegisterCnStakingContract(addr, addr, addr);
            await ab.activateAddressBook();
            var addresses = await ab.getAllAddressInfo();
            expect(addresses[0]).to.deep.equal([addr]);
            expect(addresses[1]).to.deep.equal([addr]);
            expect(addresses[2]).to.deep.equal([addr]);

            const addr2 = accounts[1].address;
            await ab.registerCnStakingContract(addr2, addr2, addr2);
            addresses = await ab.getAllAddressInfo();
            expect(addresses[0]).to.deep.equal([addr, addr2]);
            expect(addresses[1]).to.deep.equal([addr, addr2]);
            expect(addresses[2]).to.deep.equal([addr, addr2]);
        });
    });

    describe("mockRegisterCnStakingContracts", function () {
        it("mockRegisterCnStakingContracts success", async function () {
            addrs = _.map(accounts.slice(0, 10), "address");
            expect(addrs.length).to.equal(10);
            await ab.mockRegisterCnStakingContracts(addrs, addrs, addrs);
            await ab.activateAddressBook();
            var addresses = await ab.getAllAddressInfo();
            expect(addresses[0]).to.deep.equal(addrs);
            expect(addresses[1]).to.deep.equal(addrs);
            expect(addresses[2]).to.deep.equal(addrs);
        });
    });

    describe("unregisterCnStakingContract", function () {
        it("unregisterCnStakingContract success 1", async function () {
            const addr = accounts[0].address;
            const addr2 = accounts[1].address;
            await ab.registerCnStakingContract(addr, addr, addr);
            await ab.registerCnStakingContract(addr2, addr2, addr2);
            await ab.unregisterCnStakingContract(addr2);
            var addresses = await ab.getAllAddressInfo();
            expect(addresses[0]).to.deep.equal([addr]);
            expect(addresses[1]).to.deep.equal([addr]);
            expect(addresses[2]).to.deep.equal([addr]);
        });

        it("unregisterCnStakingContract success 2", async function () {
            const addr = accounts[0].address;
            const addr2 = accounts[1].address;
            await ab.registerCnStakingContract(addr, addr, addr);
            await ab.registerCnStakingContract(addr2, addr2, addr2);
            await ab.unregisterCnStakingContract(addr);
            var addresses = await ab.getAllAddressInfo();
            expect(addresses[0]).to.deep.equal([addr2]);
            expect(addresses[1]).to.deep.equal([addr2]);
            expect(addresses[2]).to.deep.equal([addr2]);
        });
    });
});
*/
