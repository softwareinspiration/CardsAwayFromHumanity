import { HostedRoom } from "../hostedRoom";
import { Game, GameMessage } from "./game";
import { GameState, GameCommand, Events, GameStage, GameEvents } from "../../../../client/shared/events";
import { Player } from "../players/player";
import { Deck } from "./deck";
import { PlayerState, SpectatorState } from "./playerState";

const GameRules = {
    maxPlayers: 8
}

export class CAFHGame implements Game<GameCommand> {

    stage: GameStage = GameStage.waitingToStart

    deck = new Deck()
    blackCard = 0

    playerStates: Record<string, PlayerState> = {}
    spectatorStates: Record<string, SpectatorState> = {}

    // State

    timer?: NodeJS.Timeout
    time = 0

    constructor(
        public room: HostedRoom
    ) { }

    // - Event Handling

    onMessage(message: GameMessage<GameCommand>): void {
        console.log(message)
        switch (message.command) {
            case GameCommand.startGame:
                if (this.isHost(message) && this.stage == GameStage.waitingToStart) {
                    this.startGame()
                }
                break
            case GameCommand.pickCard:
                break
        }
    }

    private isHost(message: GameMessage<GameCommand>) {
        return message.playerId == this.room.host.id
    }


    // - Game Lifecycle

    private startGame() {
        console.log("start game")
        this.newRound()
    }

    private newRound() {
        this.blackCard = this.deck.getBlackCard()

        for (let playerId in this.playerStates) {
            if (this.playerStates[playerId].active) {
                this.sendPlayerHand(this.playerStates[playerId].player)
            }
        }

        this.setStage(GameStage.startingRound)
    }

    private setStage(newState: GameStage) {
        let previousStage = this.stage
        this.stage = newState

        switch (this.stage) {
            case GameStage.startingRound:
                this.startTimer(10)
                break
            case GameStage.pickingCards:
                this.startTimer(90)
                break
            case GameStage.pickingWinner:
                this.startTimer(45)
                break
        }

        this.broadcastState()

    }

    private getState(): GameState {
        let state = new GameState(this.stage, this.time)

        for (let playerId in this.playerStates) {
            let playerState = this.playerStates[playerId]

            state.players.push({
                name: playerState.player.name,
                id: playerState.id,
                score: playerState.points,
                host: (playerId == this.room.host.id) ? true : undefined,
                card: (this.stage == GameStage.pickingWinner) ? playerState.pickedcard : undefined
            })
        }

        if (this.stage == GameStage.startingRound || this.stage == GameStage.pickingCards) {
            state.gameInfo.blackCard = this.blackCard
        }

        return state
    }

    private broadcastState() {
        this.room.send(GameEvents.stateChanged, this.getState())
    }

    private sendPlayerHand(player: Player) {
        player.sendEvent(GameEvents.updateHand, this.playerStates[player.id].hand)
    }

    clean(): void {

    }

    // - Time management

    startTimer(length: number) {
        console.log("starting timer " + length)
        if (this.timer !== undefined) {
            clearInterval(this.timer)
        }
        this.time = length
        this.timer = setInterval(() => { this.tick() }, 1000)
        this.tick()
    }

    tick() {

        let sendTimer = false

        switch (this.stage) {
            case GameStage.startingRound:
            case GameStage.pickingCards:
                sendTimer = true
                break
        }

        if (sendTimer) {
            this.room.send(GameEvents.timer, this.time)
        }

        if (this.time-- <= 0) {
            if (this.timer == undefined) {
                console.error("Cannot find timer?!")
                return
            }
            clearInterval(this.timer)
            this.next()
        }
    }

    next() {
        switch (this.stage) {
            case GameStage.startingRound:
                this.setStage(GameStage.pickingCards)
                break

            case GameStage.pickingCards:
                this.setStage(GameStage.pickingWinner)
                break
        }
    }

    // - Player Management

    playerJoined(player: Player): void {
        if (!this.playerStates.hasOwnProperty(player.id)) {
            let state = new PlayerState(player)
            state.hand = this.deck.pickCards(10)
            this.playerStates[player.id] = state
        } else {
            this.playerStates[player.id].active = true
        }

        this.sendPlayerHand(player)
        this.broadcastState()
    }
    playerLeft(player: Player): void {
        if (this.playerStates.hasOwnProperty(player.id)) {
            console.log("Player Left")
            this.playerStates[player.id].active = false
        } else if (this.spectatorStates.hasOwnProperty(player.id)) {
            console.log("Spectator Left")
            delete this.spectatorStates[player.id]
        }
        this.broadcastState()
    }

    canPlayerJoin(player: Player): boolean {
        let count = 0
        for (let playerId in this.playerStates) {
            if (this.playerStates[playerId].active && playerId !== player.id) {
                count++
            }
        }

        return count < GameRules.maxPlayers
    }

    // - Spectators

    spectatorJoined(player: Player) {
        if (!this.playerStates.hasOwnProperty(player.id)) {
            let state = new SpectatorState(player)
            this.spectatorStates[player.id] = state
        }

        // Spectators don't broadcast state to everyone to avoid
        // flooding players with updates if for some reason some
        // game attracts a lot of peeps.
        player.sendEvent(GameEvents.stateChanged, this.getState())
    }
}