# Klaytn governance contracts

## Audit scope

- CnStakingV2.sol
- GovParam.sol
- ICnStakingV2.sol
- IGovParam.sol
- IStakingTracker.sol
- IVoting.sol
- StakingTracker.sol
- Voting.sol

## Not scope

- legacy/\*.sol
- mock/\*.sol

## How to test

```
npx hardhat compile
npx hardhat test
npx hardhat coverage
```

## Resources

- See [./docs](./docs)
- [KIP-81](https://github.com/yeri-lee/kips/blob/master/KIPs/kip-81.md)
