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
      status: 'waiting',
      createdAt: Date.now(),
      state: {
        phase: 'placement',
        round: 1,
        timeLeft: 10,
        currentPlayer: gameData.creator,
        playerBombs: {},
        revealedFields: Array(gridSize).fill(null).map(() => Array(gridSize).fill(false))
      },
      bothPlayersReady: false,
      bombPlacements: {}
    };

    this.games.set(gameId, game);
    return game;
  }

  joinGame(gameId, playerId) {
    const game = this.games.get(gameId);
    if (!game) throw new Error('Game not found');
    if (game.opponent) throw new Error('Game is full');
    if (game.creator === playerId) throw new Error('Cannot join your own game');

    game.opponent = playerId;
    game.status = 'in-progress';
    
    this.games.set(gameId, game);
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
      }));
  }

  startGame(gameId) {
    const game = this.games.get(gameId);
    if (!game) return;

    // Start placement phase timer
    this.startTimer(gameId, 10, () => {
      this.startGameplayPhase(gameId);
    });
  }

  confirmBombPlacement(gameId, playerId, bombs) {
    const game = this.games.get(gameId);
    if (!game) return;

    game.bombPlacements[playerId] = bombs;
    
    // Check if both players have placed bombs
    const playerCount = Object.keys(game.bombPlacements).length;
    if (playerCount === 2) {
      game.bothPlayersReady = true;
      this.startGameplayPhase(gameId);
    }
  }

  startGameplayPhase(gameId) {
    const game = this.games.get(gameId);
    if (!game) return;

    game.state.phase = 'gameplay';
    game.state.timeLeft = 5;
    game.state.currentPlayer = game.creator; // Start with creator
    
    this.startTimer(gameId, 5, () => {
      this.handleRoundTimeout(gameId);
    });
  }

  revealField(gameId, playerId, x, y) {
    const game = this.games.get(gameId);
    if (!game) throw new Error('Game not found');
    if (game.state.currentPlayer !== playerId) throw new Error('Not your turn');
    if (game.state.revealedFields[x][y]) throw new Error('Field already revealed');

    // Check if field has opponent's bomb
    const opponentId = playerId === game.creator ? game.opponent : game.creator;
    const opponentBombs = game.bombPlacements[opponentId];
    
    const hasBomb = opponentBombs && opponentBombs[x] && opponentBombs[x][y] === 1;
    const content = hasBomb ? 'bomb' : 'coin';
    
    game.state.revealedFields[x][y] = true;
    
    if (hasBomb) {
      // Player hit bomb - loses round
      const winner = opponentId;
      this.endGame(gameId);
      return { gameEnded: true, winner, content };
    }

    // Continue game - switch turns
    game.state.currentPlayer = opponentId;
    game.state.round++;
    game.state.timeLeft = 5;
    
    this.startTimer(gameId, 5, () => {
      this.handleRoundTimeout(gameId);
    });

    return { gameEnded: false, content };
  }

  handleRoundTimeout(gameId) {
    const game = this.games.get(gameId);
    if (!game) return;

    // Current player loses due to timeout
    const winner = game.state.currentPlayer === game.creator ? game.opponent : game.creator;
    this.endGame(gameId);
    
    return { winner };
  }

  endGame(gameId) {
    const game = this.games.get(gameId);
    if (!game) return;

    game.status = 'completed';
    game.state.phase = 'ended';
    
    this.clearTimer(gameId);
    this.games.delete(gameId);
  }

  exitGame(gameId, playerId) {
    const game = this.games.get(gameId);
    if (!game) return;

    if (game.creator === playerId) {
      // Creator leaves - cancel game
      this.endGame(gameId);
    }
  }

  handlePlayerDisconnect(playerId) {
    // Handle player disconnection
    for (const [gameId, game] of this.games.entries()) {
      if (game.creator === playerId || game.opponent === playerId) {
        this.endGame(gameId);
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
    return Math.random().toString(36).substring(2, 15);
  }
}
