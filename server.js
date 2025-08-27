import 'dotenv/config';
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
      ? ["https://multiplayer-pvp-mine-yjkq.bolt.host", "https://bolt.new", "https://bolt.host"] 
      : "*",
    methods: ["GET", "POST"],
    credentials: true
  }
});

app.use(cors({
  origin: process.env.NODE_ENV === 'production' 
    ? ["https://multiplayer-pvp-mine-yjkq.bolt.host", "https://bolt.new", "https://bolt.host"] 
    : "*",
  credentials: true
}));
app.use(express.json());

// Basic HTTP route for health check
app.get('/', (req, res) => {
  res.json({ 
    status: 'Mines Game Server is running',
    port: PORT,
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'development'
  });
});

app.get('/health', (req, res) => {
  res.json({ 
    status: 'healthy',
    games: gameManager.games.size,
    connections: io.engine.clientsCount,
    uptime: process.uptime()
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
      
      // Create the game with the new wallet
      const game = gameManager.createGame({
        ...gameData,
        gameWallet: gameWallet.publicKey.toString(),
        gameWalletSecret: Array.from(gameWallet.secretKey)
      });

      socket.join(game.id);
      
      // Return the game data including the wallet address
      const gameResponse = {
        success: true,
        game: {
          ...game,
          gameWallet: gameWallet.publicKey.toString()
        }
      };
      
      callback(gameResponse);
      console.log('Game creation response sent:', gameResponse);
      
      // Immediately broadcast the new game to all clients so it appears in "Open Games"
      io.emit('open-games', gameManager.getOpenGames());
      console.log('Game created and broadcasted to open games list');
      
      // Also emit to the creator that they joined their own game (for UI updates)
      socket.emit('game-joined', game);
      
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
        console.error('Game not found:', data.gameId);
        return callback({ success: false, error: 'Game not found' });
      }

      if (game.status !== 'waiting') {
        console.error('Game not available for joining:', game.status);
        return callback({ success: false, error: 'Game is no longer available' });
      }

      if (game.opponent) {
        console.error('Game already full');
        return callback({ success: false, error: 'Game is already full' });
      }

      if (game.creator === data.playerId) {
        console.error('Player trying to join own game');
        return callback({ success: false, error: 'Cannot join your own game' });
      }

      if (!data.playerId) {
        console.error('No player ID provided');
        return callback({ success: false, error: 'Player ID is required' });
      }

      if (!data.betAmount || data.betAmount !== game.betAmount) {
        console.error('Invalid bet amount:', data.betAmount, 'expected:', game.betAmount);
        return callback({ success: false, error: `Bet amount must be exactly ${game.betAmount} SOL` });
        return;
      }

      console.log('Validating player funds...');
      const creatorValidation = await solanaService.validateBet(game.creator, game.betAmount);
      const joinerValidation = await solanaService.validateBet(data.playerId, data.betAmount);
      
      if (!creatorValidation.valid) {
        console.error('Creator has insufficient funds');
        return callback({ success: false, error: 'Creator has insufficient funds' });
      }
      
      if (!joinerValidation.valid) {
        console.error('Joiner has insufficient funds');
        return callback({ success: false, error: 'You have insufficient funds' });
      }

      console.log('Processing bet transfers...');
      const gameWallet = new PublicKey(game.gameWallet);
      
      // Transfer creator's bet first
      await solanaService.transferBet(game.creator, gameWallet, game.betAmount);
      console.log(`Creator ${game.creator} transferred ${game.betAmount} SOL to game wallet`);
      
      // Transfer joining player's bet to the game wallet
      await solanaService.transferBet(data.playerId, gameWallet, data.betAmount);
      console.log(`Player ${data.playerId} transferred ${data.betAmount} SOL to game wallet`);
      console.log(`Game wallet now has ${game.betAmount * 2} SOL total prize pool`);

      // Add the player to the game
      const updatedGame = gameManager.joinGame(data.gameId, data.playerId);
      
      console.log('Player successfully joined game:', updatedGame.id);
      socket.join(data.gameId);
      
      const response = { success: true, game: updatedGame };
      callback(response);
      
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
            new Uint8Array(game.gameWalletSecret),
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

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Mines Game Server running on port ${PORT}`);
  console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
});

export { app, server };
