# Postmortem: sBTC-Payment Contracts Not Deploying on Clarinet Devnet

## Action Sequence

### 1. Started Devnet and Applied Deployment


npm run devnet_reset (does a clean reset of devnet)

../bin/clarinet devnet start
../bin/clarinet deployments apply --devnet --no-dashboard

* Logs confirmed containers up:

  * API at localhost:3999
  * Core node at localhost:20443
  * Explorer at localhost:8000
  * Bitcoin regtest node and explorer running
* CLI printed Broadcasted txids:

  * sbtc-payment → 6153d1d0b541d9cb36ab4e8f3b5edc69b5b273ac36f1708a7f91da67069ff9d9
  * sbtc-token → 1512778b9c417efb142a9d3946abbbcdbcc25c00632ee1f924d895c98aef500d
    ✅ Deployment transactions were submitted to Core.

  * Contracts id are establiished by the deployment contracts (.toml) ST1PQHQKV0RJXZFY1DGX8MNSNYVE3VGZJSRTPGZGM
  * Accounts used for transactions can be seen by ../bin/clarinet console

* Stale process: verify the port being used at lsof -i :3000 (kill -9 13562)

---

### 2. Queried Transactions and Contracts

curl -s $API/extended/v1/tx/<txid>       → empty
curl -s $CORE/v2/contracts/source/$ADDR/sbtc-payment
→ "No contract source data found"

❌ Both API and Core returned nothing for those txids/contracts.

---

### 3. Verified Node Health

curl -s $CORE/v2/info | jq

Returned:

* stacks_tip_height: 192
* burn_block_height: 297
* "is_fully_synced": true
  ✅ Node is alive, synced, and sees Bitcoin burn blocks.

---

### 4. Checked Mempool

curl -s $API/extended/v1/tx/mempool

Returned:

{"limit":20,"offset":0,"total":0,"results":[]}

❌ API mempool empty — broadcast txs never visible.

Explorer UI (http://localhost:8000) also showed no pending transactions.

---

### 5. Attempted Contract Queries by Address

curl -s "$API/extended/v1/address/$ADDR/contracts?limit=50"

→ 404 “Route not found” (endpoint does not exist on local API build).

---

### 6. Forced Block Production

Manually mined regtest blocks inside bitcoin container:

docker exec -it <bitcoin-container> bitcoin-cli -regtest getnewaddress
docker exec -it <bitcoin-container> bitcoin-cli -regtest generatetoaddress 3 <addr>

* Bitcoin produced blocks (confirmed via regtest hashes).
* Core heights (burn_block_height) increased.
* ✅ Bitcoin working, Stacks node *reacted*.

But:

* stacks_tip_height did not advance after deployment → no anchored Stacks block was produced containing our txs.

---
7. Container Checks

docker compose -p clarinet-devnet ps
→ showed bitcoin-node and bitcoin-explorer containers up.

docker ps --format '{{.Names}}'
→ confirmed bitcoin-node.clarity-sbtc-payments.devnet and bitcoin-explorer.clarity-sbtc-payments.devnet.

Attempted to enter with bash:
❌ error: "bash: executable file not found in $PATH" (containers are minimal, only sh available).

Ran docker logs -f stacks-signers.clarity-sbtc-payments.devnet:
❌ No such container. (Normal: Clarinet v3.5 integrates signers inside stacks-node).

Checked stacks-api and stacks-node logs — both initializing correctly, API available at http://localhost:3999/doc.

8. Transaction + Contract Re-check

curl -s http://localhost:3999/extended/v1/tx/<txid> → empty

curl -s http://localhost:20443/v2/contracts/source/ST1PQHQK.../sbtc-payment → No contract source data found

curl -s http://localhost:3999/extended/v1/tx/mempool → empty list

Explorer UI (http://localhost:8000) → mempool empty.

❌ Confirms transactions never entered chainstate.7. Container Checks

docker compose -p clarinet-devnet ps
→ showed bitcoin-node and bitcoin-explorer containers up.

docker ps --format '{{.Names}}'
→ confirmed bitcoin-node.clarity-sbtc-payments.devnet and bitcoin-explorer.clarity-sbtc-payments.devnet.

Attempted to enter with bash:
❌ error: "bash: executable file not found in $PATH" (containers are minimal, only sh available).

Ran docker logs -f stacks-signers.clarity-sbtc-payments.devnet:
❌ No such container. (Normal: Clarinet v3.5 integrates signers inside stacks-node).


Checked stacks-api and stacks-node logs — both initializing correctly, API available at http://localhost:3999/doc.

8. Transaction + Contract Re-check

curl -s http://localhost:3999/extended/v1/tx/<txid> → empty

curl -s http://localhost:20443/v2/contracts/source/ST1PQHQK.../sbtc-payment → No contract source data found

curl -s http://localhost:3999/extended/v1/tx/mempool → empty list

Explorer UI (http://localhost:8000) → mempool empty.

❌ Confirms transactions never entered chainstate.


## Summary

* ✅ Devnet environment spun up cleanly: API, Core, Bitcoin, Explorer healthy.
* ✅ Bitcoin regtest mined new blocks and Core registered them (burn_block_height advanced).
* ❌ Stacks node did not produce an anchored block after our deployment txs → txs stayed “broadcast only,” never entered chainstate.
* ❌ API mempool never showed the txids → either dropped by policy (nonce/fee mismatch) or broadcast to a stale node.
* ❌ Contracts never appeared in Core (No contract source data found).
