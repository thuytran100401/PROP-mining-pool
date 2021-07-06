"use strict";

const { Miner, Blockchain } = require('spartan-gold');
const PoolMiner = require('./pool-miner');

const NEW_POOL_BLOCK = "NEW_POOL_BLOCK";
const SHARE_FOUND = "SHARE_FOUND";

// const SHARE_REWARD = 2;
const TOTAL_REWARD = 25;
const OPERATOR_REWARD = 5;

/**
 * In a proportional (PROP) mining pool, the rewards are divided amongst all of the miners who participated in finding the block. 
 * This design is safer for the operator, since they do not pay out rewards until a block proof is found.  
 * However, this design is vulnerable to pool-hopping attacks.
 */
module.exports = class PropPoolOperator extends Miner {

    /**
      * A pool operator needs connections to its miners, in addition to
      * the normal miner stuff.
      */
    constructor({ name, net, startingBlock, keyPair, miningRounds, poolNet } = {}) {
        super({ name, net, startingBlock, keyPair, miningRounds, poolNet });

        this.poolNet = poolNet;
        this.storedAddress = {}

        // Copying hasValidShare method from PoolMiner class.
        this.hasValidShare = PoolMiner.prototype.hasValidShare;

        // Storing transactions for next block.
        this.transactions = new Set();

        this.on(SHARE_FOUND, this.receiveShare);
    }

    /**
     * When it is time to search for a new block, the operator
     * broadcasts its block to the pool miners to find a new proof.
     */
    startNewSearch() {
        let block = Blockchain.makeBlock(this.address, this.lastBlock);

        // Add queued-up transactions to block.
        this.transactions.forEach((tx) => {
            block.addTransaction(tx, this);
        });
        this.transactions.clear();

        this.log(`Sending block ${block.id} to pool miners.`);

        // Needs to send the block to the pool miners
        this.poolNet.broadcast(NEW_POOL_BLOCK, block);
    }

    /**
     * In contrast to the standard version of SpartanGold, we queue up
     * transactions for the next block.
     * 
     * @param {Transaction} tx - The transaction we wish to add to the block.
     */
    addTransaction(tx) {
        tx = Blockchain.makeTransaction(tx);
        this.transactions.add(tx);
    }

    findProof() {
        // The operator does not mine.
    }
    /**
     * If the block has a valid proof, then the operator
     * announces it to the network and pay them
     */
    receiveShare(msg) {
        let { block, minerAddress } = msg;
        block = Blockchain.deserializeBlock(block);

        if (!this.hasValidShare(block)) {
            this.log(`Invalid share.`);
            return;
        }
        this.rewardMiner(minerAddress);

        if (block.hasValidProof()) {
            this.log(`Mining pool found proof for block ${block.chainLength}: ${block.proof}`);
            this.currentBlock = block;
            this.announceProof();
        }
    }

    /**
     * store the address of any miner who contributes a share
     * Now the miner is not paid immediately,
     *  but will receive their reward eventually.
     * 
     * @param minerAddress - Address of the miner who found a share.
     */
    rewardMiner(minerAddress) {
        //save the address
        this.storedAddress[minerAddress] = minerAddress in this.storedAddress ? this.storedAddress[minerAddress] + 1 : 1
    }

    /**
     * When we find a proof, we announce it 
     */
    announceProof() {
        super.announceProof();
        this.payRewards();
    }

    /**
     * post a transacting paying all miners who contributed a share to the last block.
     * The coinbase reward is 25 gold.
     * The operator will keep 5 gold,
     *  and divide up the remaining gold among the miners according to the amount of shares that they found.
     */
    payRewards() {
        //pay each miner who found the share for the work they did
        //amountPay based on the number of share found
        //it works 25 in total, the operator keeps 5, the remainer divides 
        //to the miner based on the number of share they find
        //when everyone is getting pay

        // Pay for the operator
        let REMAINING_REWARD = TOTAL_REWARD - OPERATOR_REWARD
        this.postTransaction([{ address: this.address, amount: OPERATOR_REWARD }], 0);
        let total = 0
        for (let minerAddress in this.storedAddress) {
            total += this.storedAddress[minerAddress]
        }
        // let total = Object.values(this.storedAddress).reduce((t, value) => t + value, 0)

        for (let minerAddress in this.storedAddress) {
            let calculated_reward = REMAINING_REWARD * (this.storedAddress[minerAddress] / total)
            this.log(`Paying ${minerAddress} ${calculated_reward} gold for their ${this.storedAddress[minerAddress]} share.`);
            this.postTransaction([{ address: minerAddress, amount: calculated_reward }], 0);
        }
    }

}
