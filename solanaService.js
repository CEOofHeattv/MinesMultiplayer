import { Connection, Keypair, PublicKey, Transaction, SystemProgram, LAMPORTS_PER_SOL } from '@solana/web3.js';

export class SolanaService {
  constructor() {
    this.connection = new Connection('https://api.devnet.solana.com', 'confirmed');
  }

  async createGameWallet() {
    return Keypair.generate();
  }

  async validateBet(playerPublicKey, betAmount) {
    try {
      const publicKey = new PublicKey(playerPublicKey);
      const balance = await this.connection.getBalance(publicKey);
      const betLamports = betAmount * LAMPORTS_PER_SOL;
      
      return {
        valid: balance >= betLamports + 5000, // Include transaction fee
        balance: balance / LAMPORTS_PER_SOL
      };
    } catch (error) {
      console.error('Error validating bet:', error);
      return { valid: false, balance: 0 };
    }
  }

  async transferBet(fromPublicKey, toPublicKey, amount) {
    try {
      console.log(`Simulating transfer of ${amount} SOL from ${fromPublicKey} to ${toPublicKey}`);
      
      // In a real implementation, this would create and send a transaction
      // For demo purposes, we'll simulate the transfer
      return {
        success: true,
        signature: 'demo_transaction_signature',
        amount: amount
      };
    } catch (error) {
      console.error('Error transferring bet:', error);
      throw error;
    }
  }

  async payoutWinner(gameWalletSecret, winnerPublicKey, amount) {
    try {
      console.log(`Simulating payout of ${amount} SOL to winner ${winnerPublicKey}`);
      
      // In a real implementation, this would:
      // 1. Create a transaction from the game wallet to the winner
      // 2. Sign with the game wallet secret key
      // 3. Send the transaction
      
      const gameWallet = Keypair.fromSecretKey(new Uint8Array(gameWalletSecret));
      
      // Simulate the payout
      return {
        success: true,
        signature: 'demo_payout_signature',
        amount: amount,
        recipient: winnerPublicKey
      };
    } catch (error) {
      console.error('Error paying out winner:', error);
      throw error;
    }
  }

  async getBalance(publicKey) {
    try {
      const balance = await this.connection.getBalance(new PublicKey(publicKey));
      return balance / LAMPORTS_PER_SOL;
    } catch (error) {
      console.error('Error getting balance:', error);
      return 0;
    }
  }
}
