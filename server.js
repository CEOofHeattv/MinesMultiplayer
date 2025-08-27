import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import { Connection, Keypair, PublicKey, Transaction, SystemProgram, LAMPORTS_PER_SOL } from '@solana/web3.js';
import { GameManager } from './gameManager.js';
import { SolanaService } from './solanaService.js';

const app = express();
const server = createServer(app);
const io = new Server(server, {
  cors: {
    origin: process.env.NODE_ENV === 'production' 
      ? ["https://your-frontend-domain.com", "https://bolt.new"] 
      : "*",
    methods: ["GET", "POST"]
  }
});

app.use(cors());
app.use(express.json());

// Basic HTTP route for health check
app.get('/', (req, res) => {
  res.json({ 
    status: 'Game server is running',
    port: PORT,
    timestamp: new Date().toISOString()
  });
});

app.get('/health', (req, res) => {
  res.json({ 
    status: 'healthy',
    games: gameManager.games.size,
    connections: io.engine.clientsCount
  });
});

const gameManager = new GameManager();
const solanaService = new SolanaService();

io.on('connection', (socket) => {
  console.log(`Player connected: ${socket.id}`);
  
  const playerId = socket.handshake.query.playerId;
  
  socket.on('create-game', async (gameData, callback) => {
    try {
      console.log('Creating game:', gameData);
      
      // Create a new game wallet for this specific game
      const gameWallet = await solanaService.createGameWallet();
      console.log('Created game wallet:', gameWallet.publicKey.toString());
      
      // Validate creator's bet amount
      const betValidation = await solanaService.validateBet(gameData.creator, gameData.betAmount);
      
      if (!betValidation.valid) {
        callback({ success: false, error: 'Insufficient funds or invalid bet amount' });
        return;
      }

      // Create the game with the new wallet
      const game = gameManager.createGame({
        ...gameData,
        gameWallet: gameWallet.publicKey.toString(),
        gameWalletSecret: gameWallet.secretKey
      });

      // Transfer creator's bet to the game wallet
      await solanaService.transferBet(gameData.creator, gameWallet.publicKey, gameData.betAmount);
      console.log(`Creator ${gameData.creator} transferred ${gameData.betAmount} SOL to game wallet`);
      
      socket.join(game.id);
      callback({ success: true, game });
      
      // Immediately broadcast the new game to all clients so it appears in "Open Games"
      io.emit('open-games', gameManager.getOpenGames());
      console.log('Game created and broadcasted to open games list');
      
    } catch (error) {
      console.error('Error creating game:', error);
      callback({ success: false, error: error.message });
    }
  });

  socket.on('join-game', async (data, callback) => {
    try {
      console.log('Joining game:', data);
      
      const game = gameManager.getGame(data.gameId);
      if (!game) {
        callback({ success: false, error: 'Game not found' });
        return;
      }

      // Ensure the joining player bets the exact same amount as the creator
      if (data.betAmount !== game.betAmount) {
        callback({ success: false, error: `Bet amount must be exactly ${game.betAmount} SOL` });
        return;
      }

      // Validate joining player has sufficient funds
      const betValidation = await solanaService.validateBet(data.playerId, data.betAmount);
      if (!betValidation.valid) {
        callback({ success: false, error: 'Insufficient funds' });
        return;
      }

      // Transfer joining player's bet to the same game wallet
      const gameWallet = new PublicKey(game.gameWallet);
      await solanaService.transferBet(data.playerId, gameWallet, data.betAmount);
      console.log(`Player ${data.playerId} transferred ${data.betAmount} SOL to game wallet`);
      console.log(`Game wallet now has ${game.betAmount * 2} SOL total prize pool`);

      // Add the player to the game
      const updatedGame = gameManager.joinGame(data.gameId, data.playerId);
      
      socket.join(data.gameId);
      callback({ success: true, game: updatedGame });
      
      // Notify both players that the game is starting
      io.to(data.gameId).emit('game-started', updatedGame);
      
      // Start the game (bomb placement phase)
      gameManager.startGame(data.gameId);
      
      // Remove this game from open games list since it's now full
      io.emit('open-games', gameManager.getOpenGames());
      console.log('Game started with both players, removed from open games');
      
    } catch (error) {
      console.error('Error joining game:', error);
      callback({ success: false, error: error.message });
    }
  });

  socket.on('get-open-games', () => {
    socket.emit('open-games', gameManager.getOpenGames());
  });

  socket.on('confirm-bomb-placement', (data) => {
    try {
      const { gameId, bombs } = data;
      gameManager.confirmBombPlacement(gameId, playerId, bombs);
      
      // Check if both players confirmed
      const game = gameManager.getGame(gameId);
      if (game && game.bothPlayersReady) {
        gameManager.startGameplayPhase(gameId);
        io.to(gameId).emit('game-state-update', game.state);
      }
    } catch (error) {
      console.error('Error confirming bomb placement:', error);
    }
  });

  socket.on('reveal-field', async (data) => {
    try {
      const { gameId, x, y } = data;
      const result = gameManager.revealField(gameId, playerId, x, y);
      
      if (result.gameEnded) {
        // Handle game end and payout
        const game = gameManager.getGame(gameId);
        if (game && result.winner) {
          await solanaService.payoutWinner(
            game.gameWalletSecret,
            result.winner,
            game.betAmount * 2
          );
        }
        
        io.to(gameId).emit('game-winner', { winner: result.winner });
        gameManager.endGame(gameId);
      } else {
        io.to(gameId).emit('field-revealed', { x, y, content: result.content });
        io.to(gameId).emit('game-state-update', gameManager.getGame(gameId).state);
      }
    } catch (error) {
      console.error('Error revealing field:', error);
    }
  });

  socket.on('exit-game', (data) => {
    try {
      gameManager.exitGame(data.gameId, playerId);
      socket.leave(data.gameId);
      io.emit('open-games', gameManager.getOpenGames());
    } catch (error) {
      console.error('Error exiting game:', error);
    }
  });

  socket.on('disconnect', () => {
    console.log(`Player disconnected: ${socket.id}`);
    gameManager.handlePlayerDisconnect(playerId);
    io.emit('open-games', gameManager.getOpenGames());
  });
});

const PORT = process.env.PORT || 3001;

server.listen(PORT, () => {
  console.log(`Game server running on port ${PORT}`);
});

export { app, server };
