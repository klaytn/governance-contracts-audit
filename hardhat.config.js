/* eslint-disable */
require("dotenv").config();

require("@nomiclabs/hardhat-web3");
require("@nomiclabs/hardhat-etherscan");
require("@nomiclabs/hardhat-waffle");
require("hardhat-gas-reporter");
require("solidity-coverage");
require('@openzeppelin/hardhat-upgrades');
require("@nomiclabs/hardhat-ethers");
require('@nomiclabs/hardhat-truffle5');

const ethers = require("ethers");
const process = require("process");

const defaultBalance = ethers.utils.parseUnits((1e12).toString(), 'ether').toString();

// @type import('hardhat/config').HardhatUserConfig
// https://hardhat.org/config/
// https://hardhat.org/hardhat-network/docs/reference
module.exports = {
  solidity: {
    compilers: [
      {
        version: '0.8.4',
        settings: { optimizer: { enabled: true, runs: 1000 } }
      },
      {
        version: '0.4.24',
        settings: { optimizer: { enabled: true, runs: 1000 } }
      },
    ],
    settings: {}
  },
  defaultNetwork: "hardhat",
  networks: {
    'hardhat': {
      blockGasLimit: 60e6, // kip71.maxblockgasusedforbasefee
      allowUnlimitedContractSize: true,
      accounts: {
        accountsBalance: defaultBalance,
      },
    },
  },
  gasReporter: { // Run `REPORT_GAS=1 npx hardhat test` to see gasUsed stats
    enabled: process.env.REPORT_GAS !== undefined,
    currency: "USD",
    ethPrice: 1.0, // in USD
    gasPrice: 25, // in ston
    showTimeSpent: true,
  },
};
