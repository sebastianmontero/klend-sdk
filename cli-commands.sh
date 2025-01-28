## KLEND SDK CLI
# Mainnet
yarn cli print-borrow-rate --url https://mainnet.helius-rpc.com/?api-key=ae614c65-c2ec-4c08-8157-8d1ab0931982 --cluster mainnet-beta --token USDC
yarn cli print-reserve --url https://mainnet.helius-rpc.com/?api-key=ae614c65-c2ec-4c08-8157-8d1ab0931982 --cluster mainnet-beta --symbol USDC
yarn cli print-reserve --url https://mainnet.helius-rpc.com/?api-key=ae614c65-c2ec-4c08-8157-8d1ab0931982 --cluster mainnet-beta --reserve D6q6wuQSrifJKZYpR1M8R4YawnLDtDsMmWM1NbBmgJ59
yarn cli print-all-lending-market-accounts --rpc https://mainnet.helius-rpc.com/?api-key=ae614c65-c2ec-4c08-8157-8d1ab0931982
yarn cli print-all-reserve-accounts --rpc https://mainnet.helius-rpc.com/?api-key=ae614c65-c2ec-4c08-8157-8d1ab0931982
yarn cli print-market --rpc https://mainnet.helius-rpc.com/?api-key=ae614c65-c2ec-4c08-8157-8d1ab0931982 --cluster mainnet-beta
yarn cli print-oracle-prices --rpc https://mainnet.helius-rpc.com/?api-key=ae614c65-c2ec-4c08-8157-8d1ab0931982 --cluster mainnet-beta --price-oracle-account 3NJYftD5sjVfxSnUdZ1wVML8f3aC6mp1CXCL6L7TnU8C


# Local
yarn cli print-borrow-rate --url http://localhost:8899 --cluster mainnet-beta --token USDC
yarn cli print-reserve --url http://localhost:8899 --cluster mainnet-beta --symbol USDC
yarn cli print-reserve --url http://localhost:8899 --cluster mainnet-beta --reserve D6q6wuQSrifJKZYpR1M8R4YawnLDtDsMmWM1NbBmgJ59
yarn cli print-all-lending-market-accounts --rpc http://localhost:8899
yarn cli print-all-reserve-accounts --rpc http://localhost:8899
yarn cli print-market --rpc http://localhost:8899 --cluster mainnet-beta
yarn cli deposit --url http://localhost:8899 --owner /home/sebastian/.config/solana/id.json --token USDC --amount 10000000 --cluster mainnet-beta
yarn cli print-obligation --rpc http://localhost:8899 --cluster mainnet-beta  --obligation CDnBXnLZNip4EPXecW7J3wxYHShwYrnJx3qnZGjRiHqn
yarn cli print-user-metadata --rpc http://localhost:8899 --cluster mainnet-beta  --user E5F29wyzm1etJCWJ75uU4DBGPHKYcvbLaspz2kByS9et

## KFARM SDK CLI
# Mainnet
yarn cli download-all-farm-configs --target-path ./

# Find a program derived address
# Ex. getting the lending market authority address
solana find-program-derived-address KLend2g3cP87fffoy8q1mQqGKjrxjC8boSyAYavgmjD string:lma pubkey:7u3HeHxYDLhnCoErrtycNokbQYbWGzLs6JSDqGAv5PfF

# Ex. getting the user metadata address
solana find-program-derived-address KLend2g3cP87fffoy8q1mQqGKjrxjC8boSyAYavgmjD string:user_meta pubkey:E5F29wyzm1etJCWJ75uU4DBGPHKYcvbLaspz2kByS9et
# Result: Fig6CSJAM1nMyMx59ZH5dw4k23ajoD1WiQkuZf7SJYBi



# Clone Metaplex
solana program dump -u m metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s metaplex.so
solana account -u m EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v --output-file usdc.json --output json
solana account -u m 5x38Kp4hvdomTCnCrAny4UtMUt5rQBdB6px2K1Ui45Wq --output-file usdc-metadata.json --output json

# Clone Kamino Lending
solana program dump -u m KLend2g3cP87fffoy8q1mQqGKjrxjC8boSyAYavgmjD kamino-lending.so

# Kamino main market account
solana account -u m 7u3HeHxYDLhnCoErrtycNokbQYbWGzLs6JSDqGAv5PfF --output-file kamino-mainnet-market.json --output json
# Kamino main market authority account
solana account -u m 9DrvZvyWh1HuAoZxvYWMvkf2XCzryCpGgHqrMjyDWpmo --output-file kamino-mainnet-market-authority.json --output json
# Kamino main market owner account
solana account -u m A9rQoX1sictAQkyXxaZA8nz674xutHwoqpK2mwLyexCZ --output-file kamino-mainnet-market-owner.json --output json

## USDC reserve related accounts for main market
# Reserve account
solana account -u m D6q6wuQSrifJKZYpR1M8R4YawnLDtDsMmWM1NbBmgJ59 --output-file usdc-reserve-kamino-main-market-account.json --output json
# Liquidity Supply vault account
solana account -u m Bgq7trRgVMeq33yt235zM2onQ4bRDBsY5EWiTetF4qw6 --output-file usdc-liquidity-supply-vault-kamino-main-market-account.json --output json
# Liquidity Fee vault account
solana account -u m BbDUrk1bVtSixgQsPLBJFZEF7mwGstnD5joA1WzYvYFX --output-file usdc-liquidity-fee-vault-kamino-main-market-account.json --output json
# Collateral mint account
solana account -u m B8V6WVjPxW1UGwVDfxH2d2r8SyT4cqn7dQRK6XneVa7D --output-file usdc-collateral-mint-kamino-main-market-account.json --output json
# Collateral supply vault account
solana account -u m 3DzjXRfxRm6iejfyyMynR4tScddaanrePJ1NJU2XnPPL --output-file usdc-collateral-supply-vault-kamino-main-market-account.json --output json
# Price oracle account
solana account -u m 3NJYftD5sjVfxSnUdZ1wVML8f3aC6mp1CXCL6L7TnU8C --output-file usdc-price-oracle-kamino-main-market-account.json --output json


# Clone Kamino Farm
solana program dump -u m FarmsPZpWu9i7Kky8tPN37rs2TpmMrAZrC7S7vJa91Hr kamino_farm.so
# Kamin from global config account
solana account -u m 6UodrBjL2ZreDy7QdR4YV1oxqMBjVYSEyrFpctqqwGwL --output-file kamino-farm-global-config-account.json --output json

## USDC farm related accounts for main market
# Farm state account
solana account -u m JAvnB9AKtgPsTEoKmn24Bq64UMoYcrtWtq42HHBdsPkh --output-file usdc-farm-state-kamino-main-market-account.json --output json



solana-test-validator -r --bpf-program metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s metaplex.so --bpf-program KLend2g3cP87fffoy8q1mQqGKjrxjC8boSyAYavgmjD kamino-lending.so --account EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v usdc.json --account 5x38Kp4hvdomTCnCrAny4UtMUt5rQBdB6px2K1Ui45Wq usdc-metadata.json  --account 7u3HeHxYDLhnCoErrtycNokbQYbWGzLs6JSDqGAv5PfF kamino-mainnet-market.json --account 9DrvZvyWh1HuAoZxvYWMvkf2XCzryCpGgHqrMjyDWpmo kamino-mainnet-market-authority.json --account A9rQoX1sictAQkyXxaZA8nz674xutHwoqpK2mwLyexCZ kamino-mainnet-market-owner.json --account D6q6wuQSrifJKZYpR1M8R4YawnLDtDsMmWM1NbBmgJ59 usdc-reserve-kamino-main-market-account.json --account Bgq7trRgVMeq33yt235zM2onQ4bRDBsY5EWiTetF4qw6 usdc-liquidity-supply-vault-kamino-main-market-account.json --account BbDUrk1bVtSixgQsPLBJFZEF7mwGstnD5joA1WzYvYFX usdc-liquidity-fee-vault-kamino-main-market-account.json --account B8V6WVjPxW1UGwVDfxH2d2r8SyT4cqn7dQRK6XneVa7D usdc-collateral-mint-kamino-main-market-account.json --account 3DzjXRfxRm6iejfyyMynR4tScddaanrePJ1NJU2XnPPL usdc-collateral-supply-vault-kamino-main-market-account.json --account 3NJYftD5sjVfxSnUdZ1wVML8f3aC6mp1CXCL6L7TnU8C usdc-price-oracle-kamino-main-market-account.json

solana-test-validator -r -u m  --bpf-program metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s metaplex.so --bpf-program KLend2g3cP87fffoy8q1mQqGKjrxjC8boSyAYavgmjD kamino_lending.so --bpf-program FarmsPZpWu9i7Kky8tPN37rs2TpmMrAZrC7S7vJa91Hr kamino_farm.so --account EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v usdc.json --account 5x38Kp4hvdomTCnCrAny4UtMUt5rQBdB6px2K1Ui45Wq usdc-metadata.json -c 7u3HeHxYDLhnCoErrtycNokbQYbWGzLs6JSDqGAv5PfF -c 9DrvZvyWh1HuAoZxvYWMvkf2XCzryCpGgHqrMjyDWpmo -c A9rQoX1sictAQkyXxaZA8nz674xutHwoqpK2mwLyexCZ  -c D6q6wuQSrifJKZYpR1M8R4YawnLDtDsMmWM1NbBmgJ59 -c Bgq7trRgVMeq33yt235zM2onQ4bRDBsY5EWiTetF4qw6  -c BbDUrk1bVtSixgQsPLBJFZEF7mwGstnD5joA1WzYvYFX -c B8V6WVjPxW1UGwVDfxH2d2r8SyT4cqn7dQRK6XneVa7D -c 3DzjXRfxRm6iejfyyMynR4tScddaanrePJ1NJU2XnPPL -c 3NJYftD5sjVfxSnUdZ1wVML8f3aC6mp1CXCL6L7TnU8C -c 6UodrBjL2ZreDy7QdR4YV1oxqMBjVYSEyrFpctqqwGwL -c JAvnB9AKtgPsTEoKmn24Bq64UMoYcrtWtq42HHBdsPkh


spl-token -u l display EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v

#Create associated token account
spl-token -u l create-account EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v
# created account: Cd6c6pbo5jutxSVTcfYveRgsDjyWaKo1gYWq7n1Lww12

#Mint tokens to the associated token account
spl-token -u l mint EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v 1000000000 Cd6c6pbo5jutxSVTcfYveRgsDjyWaKo1gYWq7n1Lww12

#Check balance
spl-token -u l balance EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v

