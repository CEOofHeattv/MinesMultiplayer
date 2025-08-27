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
      : ["http://localhost:5173", "http://localhost:3000"],
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
      
      // Create game wallet and validate bet
      const gameWallet = await solanaService.createGameWallet();
      const betValidation = await solanaService.validateBet(gameData.creator, gameData.betAmount);
      
      if (!betValidation.valid) {
        callback({ success: false, error: 'Insufficient funds or invalid bet amount' });
        return;
      }

      const game = gameManager.createGame({
        ...gameData,
        gameWallet: gameWallet.publicKey.toString(),
        gameWalletSecret: gameWallet.secretKey
      });

      // Transfer bet to game wallet
      await solanaService.transferBet(gameData.creator, gameWallet.publicKey, gameData.betAmount);
      
      socket.join(game.id);
      callback({ success: true, game });
      
      // Broadcast updated games list
      io.emit('open-games', gameManager.getOpenGames());
      
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

      // Validate bet amount matches
      if (data.betAmount !== game.betAmount) {
        callback({ success: false, error: 'Bet amount must match game bet' });
        return;
      }

      // Validate and transfer bet
      const betValidation = await solanaService.validateBet(data.playerId, data.betAmount);
      if (!betValidation.valid) {
        callback({ success: false, error: 'Insufficient funds' });
        return;
      }

      const gameWallet = new PublicKey(game.gameWallet);
      await solanaService.transferBet(data.playerId, gameWallet, data.betAmount);

      // Join game
      const updatedGame = gameManager.joinGame(data.gameId, data.playerId);
      
      socket.join(data.gameId);
      callback({ success: true, game: updatedGame });
      
      // Notify both players
      io.to(data.gameId).emit('game-started', updatedGame);
      
      // Start game timer
      gameManager.startGame(data.gameId);
      
      // Broadcast updated games list
      io.emit('open-games', gameManager.getOpenGames());
      
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
