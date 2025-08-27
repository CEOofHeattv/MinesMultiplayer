export class GameManager {
  constructor() {
    this.games = new Map();
    this.timers = new Map();
  }

  createGame(gameData) {
    const gameId = this.generateGameId();
    const gridSize = parseInt(gameData.size.charAt(0));
    
    const game = {
      id: gameId,
      creator: gameData.creator,
      opponent: null,
      size: gameData.size,
      bombs: gameData.bombs,
      betAmount: gameData.betAmount,
      gameWallet: gameData.gameWallet,
      gameWalletSecret: gameData.gameWalletSecret,
      status: 'waiting', // This keeps the game in "open games" until someone joins
      createdAt: Date.now(),
      state: {
        phase: 'placement',
        round: 1,
        timeLeft: 30, // Increased placement time
        currentPlayer: gameData.creator,
        playerBombs: {},
        revealedFields: Array(gridSize).fill(null).map(() => Array(gridSize).fill(false))
      },
      bothPlayersReady: false,
      bombPlacements: {}
    };

    this.games.set(gameId, game);
    console.log(`Game ${gameId} created with wallet ${gameData.gameWallet}`);
    return game;
  }

  joinGame(gameId, playerId) {
    const game = this.games.get(gameId);
    if (!game) throw new Error('Game not found');
    if (game.opponent) throw new Error('Game is full');
    if (game.creator === playerId) throw new Error('Cannot join your own game');

    game.opponent = playerId;
    game.status = 'in-progress'; // This removes it from "open games"
    
    this.games.set(gameId, game);
    console.log(`Player ${playerId} joined game ${gameId}`);
    return game;
  }

  getGame(gameId) {
    return this.games.get(gameId);
  }

  getOpenGames() {
    return Array.from(this.games.values())
      .filter(game => game.status === 'waiting')
      .map(game => ({
        id: game.id,
        creator: game.creator,
        size: game.size,
        bombs: game.bombs,
        betAmount: game.betAmount,
        status: game.status,
        createdAt: game.createdAt
      }))
      .sort((a, b) => b.createdAt - a.createdAt); // Sort by newest first
  }

  startGame(gameId) {
    const game = this.games.get(gameId);
    if (!game) return;

    // Start placement phase timer
    this.startTimer(gameId, 10, () => {
      // Auto-place random bombs if players don't place them in time
      this.autoPlaceBombs(gameId);
      this.startGameplayPhase(gameId);
    });
  }

  autoPlaceBombs(gameId) {
    const game = this.games.get(gameId);
    if (!game) return;

    const gridSize = parseInt(game.size.charAt(0));
    const players = [game.creator, game.opponent].filter(Boolean);

    players.forEach(playerId => {
      if (!game.bombPlacements[playerId]) {
        // Auto-place random bombs
        const bombs = Array(gridSize).fill(null).map(() => Array(gridSize).fill(0));
        const positions = [];
        
        // Generate all possible positions
        for (let x = 0; x < gridSize; x++) {
          for (let y = 0; y < gridSize; y++) {
            positions.push([x, y]);
          }
        }
        
        // Randomly select bomb positions
        for (let i = 0; i < game.bombs; i++) {
          if (positions.length > 0) {
            const randomIndex = Math.floor(Math.random() * positions.length);
            const [x, y] = positions.splice(randomIndex, 1)[0];
            bombs[x][y] = 1;
          }
        }
        
        game.bombPlacements[playerId] = bombs;
        console.log(`Auto-placed bombs for player ${playerId} in game ${gameId}`);
      }
    });

    game.bothPlayersReady = true;
  }

  confirmBombPlacement(gameId, playerId, bombs) {
    const game = this.games.get(gameId);
    if (!game) return;

    game.bombPlacements[playerId] = bombs;
    console.log(`Player ${playerId} confirmed bomb placement in game ${gameId}`);
    
    // Check if both players have placed bombs
    const playerCount = Object.keys(game.bombPlacements).length;
    if (playerCount === 2) {
      game.bothPlayersReady = true;
      this.clearTimer(gameId);
      this.startGameplayPhase(gameId);
    }
  }

  startGameplayPhase(gameId) {
    const game = this.games.get(gameId);
    if (!game) return;

    game.state.phase = 'gameplay';
    game.state.timeLeft = 5; // 5 seconds per turn
    game.state.currentPlayer = game.creator; // Start with creator
    
    console.log(`Starting gameplay phase for game ${gameId}`);
    
    this.startTimer(gameId, 5, () => {
      this.handleRoundTimeout(gameId);
    });
  }

  revealField(gameId, playerId, x, y) {
    const game = this.games.get(gameId);
    if (!game) throw new Error('Game not found');
    if (game.state.phase !== 'gameplay') throw new Error('Game not in gameplay phase');
    if (game.state.currentPlayer !== playerId) throw new Error('Not your turn');
    if (game.state.revealedFields[x][y]) throw new Error('Field already revealed');

    // Check if field has opponent's bomb
    const opponentId = playerId === game.creator ? game.opponent : game.creator;
    const opponentBombs = game.bombPlacements[opponentId];
    
    const hasBomb = opponentBombs && opponentBombs[x] && opponentBombs[x][y] === 1;
    const content = hasBomb ? 'bomb' : 'coin';
    
    game.state.revealedFields[x][y] = true;
    
    console.log(`Player ${playerId} revealed field [${x},${y}] with content: ${content}`);
    
    if (hasBomb) {
      // Player hit bomb - loses round
      const winner = opponentId;
      console.log(`Game ${gameId} ended. Winner: ${winner}`);
      return { gameEnded: true, winner, content };
    }

    // Continue game - switch turns
    game.state.currentPlayer = opponentId;
    game.state.round++;
    game.state.timeLeft = 5;
    
    this.clearTimer(gameId);
    this.startTimer(gameId, 5, () => {
      this.handleRoundTimeout(gameId);
    });

    return { gameEnded: false, content };
  }

  handleRoundTimeout(gameId) {
    const game = this.games.get(gameId);
    if (!game) return;

    console.log(`Round timeout in game ${gameId}. Current player: ${game.state.currentPlayer}`);
    
    // Current player loses due to timeout
    const winner = game.state.currentPlayer === game.creator ? game.opponent : game.creator;
    
    console.log(`Game ${gameId} ended due to timeout. Winner: ${winner}`);
    return { winner };
  }

  endGame(gameId) {
    const game = this.games.get(gameId);
    if (!game) return;

    game.status = 'completed';
    game.state.phase = 'ended';
    
    this.clearTimer(gameId);
    
    console.log(`Game ${gameId} ended and cleaned up`);
    
    // Clean up after a delay to allow final messages
    setTimeout(() => {
      this.games.delete(gameId);
    }, 5000);
  }

  exitGame(gameId, playerId) {
    const game = this.games.get(gameId);
    if (!game) return;

    console.log(`Player ${playerId} exiting game ${gameId}`);

    if (game.creator === playerId && !game.opponent) {
      // Creator leaves before anyone joins - just delete the game
      this.endGame(gameId);
    } else if (game.creator === playerId || game.opponent === playerId) {
      // Player leaves during active game - opponent wins by forfeit
      const winner = game.creator === playerId ? game.opponent : game.creator;
      console.log(`Player ${playerId} forfeited. Winner: ${winner}`);
      // Handle forfeit payout if needed
      this.endGame(gameId);
    }
  }

  handlePlayerDisconnect(playerId) {
    console.log(`Handling disconnect for player ${playerId}`);
    
    // Handle player disconnection
    for (const [gameId, game] of this.games.entries()) {
      if (game.creator === playerId || game.opponent === playerId) {
        console.log(`Player ${playerId} disconnected from game ${gameId}`);
        this.exitGame(gameId, playerId);
      }
    }
  }

  startTimer(gameId, seconds, onComplete) {
    this.clearTimer(gameId);
    
    let timeLeft = seconds;
    const timerId = setInterval(() => {
      const game = this.games.get(gameId);
      if (!game) {
        this.clearTimer(gameId);
        return;
      }

      timeLeft--;
      game.state.timeLeft = timeLeft;
      
      if (timeLeft <= 0) {
        this.clearTimer(gameId);
        onComplete();
      }
    }, 1000);

    this.timers.set(gameId, timerId);
  }

  clearTimer(gameId) {
    const timerId = this.timers.get(gameId);
    if (timerId) {
      clearInterval(timerId);
      this.timers.delete(gameId);
    }
  }

  generateGameId() {
    return Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
  }

  // Cleanup old games periodically
  cleanupOldGames() {
    const now = Date.now();
    const maxAge = 30 * 60 * 1000; // 30 minutes

    for (const [gameId, game] of this.games.entries()) {
      if (now - game.createdAt > maxAge) {
        console.log(`Cleaning up old game ${gameId}`);
        this.endGame(gameId);
      }
    }
  }
}

// Clean up old games every 10 minutes
setInterval(() => {
  if (global.gameManager) {
    global.gameManager.cleanupOldGames();
  }
}, 10 * 60 * 1000);
