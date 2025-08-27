import { Connection, Keypair, PublicKey, Transaction, SystemProgram, LAMPORTS_PER_SOL } from '@solana/web3.js';

export class SolanaService {
  constructor() {
    // Use devnet for development, mainnet-beta for production
    const endpoint = process.env.NODE_ENV === 'production' 
      ? 'https://api.mainnet-beta.solana.com'
      : 'https://api.devnet.solana.com';
    
    this.connection = new Connection(endpoint, 'confirmed');
    console.log(`Solana service initialized with endpoint: ${endpoint}`);
  }

  async createGameWallet() {
    const wallet = Keypair.generate();
    console.log(`Created new game wallet: ${wallet.publicKey.toString()}`);
    return wallet;
  }

  async validateBet(playerPublicKey, betAmount) {
    try {
      const publicKey = new PublicKey(playerPublicKey);
      const balance = await this.connection.getBalance(publicKey);
      const betLamports = betAmount * LAMPORTS_PER_SOL;
      const requiredBalance = betLamports + 10000; // Include transaction fees
      
      console.log(`Validating bet for ${playerPublicKey}: Balance ${balance / LAMPORTS_PER_SOL} SOL, Required: ${requiredBalance / LAMPORTS_PER_SOL} SOL`);
      
      return {
        valid: balance >= requiredBalance,
        balance: balance / LAMPORTS_PER_SOL,
        required: requiredBalance / LAMPORTS_PER_SOL
      };
    } catch (error) {
      console.error('Error validating bet:', error);
      return { valid: false, balance: 0, error: error.message };
    }
  }

  async transferBet(fromPublicKey, toPublicKey, amount) {
    try {
      console.log(`Processing transfer of ${amount} SOL from ${fromPublicKey} to ${toPublicKey.toString()}`);
      
      // In a real implementation, this would:
      // 1. Create a transaction to transfer SOL
      // 2. Request the user to sign it via their wallet
      // 3. Send the signed transaction to the network
      
      // For demo purposes, we simulate the transfer
      const simulatedResult = {
        success: true,
        signature: `demo_tx_${Date.now()}_${Math.random().toString(36).substring(7)}`,
        amount: amount,
        from: fromPublicKey,
        to: toPublicKey.toString(),
        timestamp: new Date().toISOString()
      };
      
      console.log('Transfer simulation result:', simulatedResult);
      return simulatedResult;
      
    } catch (error) {
      console.error('Error transferring bet:', error);
      throw new Error(`Transfer failed: ${error.message}`);
    }
  }

  async payoutWinner(gameWalletSecret, winnerPublicKey, amount) {
    try {
      console.log(`Processing payout of ${amount} SOL to winner ${winnerPublicKey}`);
      
      // In a real implementation, this would:
      // 1. Create a transaction from the game wallet to the winner
      // 2. Sign it with the game wallet's secret key
      // 3. Send the transaction to the network
      
      const gameWallet = Keypair.fromSecretKey(gameWalletSecret);
      
      // Simulate the payout
      const simulatedPayout = {
        success: true,
        signature: `payout_tx_${Date.now()}_${Math.random().toString(36).substring(7)}`,
        amount: amount,
        recipient: winnerPublicKey,
        gameWallet: gameWallet.publicKey.toString(),
        timestamp: new Date().toISOString()
      };
      
      console.log('Payout simulation result:', simulatedPayout);
      return simulatedPayout;
      
    } catch (error) {
      console.error('Error paying out winner:', error);
      throw new Error(`Payout failed: ${error.message}`);
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

  async getGameWalletBalance(gameWalletPublicKey) {
    try {
      const balance = await this.connection.getBalance(new PublicKey(gameWalletPublicKey));
      console.log(`Game wallet ${gameWalletPublicKey} balance: ${balance / LAMPORTS_PER_SOL} SOL`);
      return balance / LAMPORTS_PER_SOL;
    } catch (error) {
      console.error('Error getting game wallet balance:', error);
      return 0;
    }
  }

  // Utility method to check if a public key is valid
  isValidPublicKey(publicKeyString) {
    try {
      new PublicKey(publicKeyString);
      return true;
    } catch {
      return false;
    }
  }

  // Get transaction confirmation
  async confirmTransaction(signature) {
    try {
      const confirmation = await this.connection.confirmTransaction(signature);
      return confirmation;
    } catch (error) {
      console.error('Error confirming transaction:', error);
      return null;
    }
  }
}
