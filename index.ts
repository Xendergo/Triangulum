import type { Registry } from "./registry"

export * from "./registry"
export * from "./defaultStrategies"
export * from "./inputFields"

/**
 * A class representing a class that can be sent via websockets
 * The `channel` field doesn't have to be overriden since the {@link MakeSendable} or {@link MakeNbtSendable} decorator will do that for you
 */
export abstract class Sendable {
    channel: string | undefined

    static channel() {
        return this.prototype.channel as string
    }
}

interface Awaiter {
    channel: string
    predicate: (data: Sendable) => boolean
    resolve: (data: Sendable) => void
}

/**
 * An interface to make dealing with unknown ListenerManagers easier
 *
 * Instead of implementing this interface, you'd probably have a nicer time implementing {@link AbstractListenerManager}
 *
 * @typeParam `TransferringType` The type of data you're allowed to send through this listener manager
 */
export interface ListenerManager<TransferringType extends Sendable> {
    /**
     * Listen for data sent by the other side of this connection, the data's prototype is also changed automatically so you get an actual instance of the class back
     * @param channelClass The class you're expecting to receive
     * @param callback Called when the listener manager received data on this channel
     */
    listen<T extends TransferringType>(
        channelClass: { channel(): string; new (...data: any[]): T },
        callback: (data: T) => void
    ): void

    /**
     * Stop listening for data on the other side of this connection
     * @param channelClass The class the callback expects to receive
     * @param callback The callback to unsubscribe
     */
    stopListening<T extends TransferringType>(
        channelClass: { channel(): string; new (...data: any[]): T },
        callback: (data: T) => void
    ): void

    /**
     * Send data to the other side of this connection
     * @param data The data to send
     */
    send<T extends TransferringType>(data: T): void

    /**
     * Returns a promise that gets resolved when message of the expected class gets received, allowing you to await messages from the other side of the connection
     *
     * Only one awaiter can receive a message
     * The priority of who gets what is decided by who called awaitMessage first
     * A message can't trigger listeners if it's captured by a call of awaitMessage
     *
     * @param channelClass The class representing the data you want to await
     * @param predicate Decides whether you want the promise to get resolved for the given channelClass
     * @returns A promise that gets resolved when a message comes in that matches the channelClass and predicate
     */
    awaitMessage<T extends TransferringType>(
        channelClass: { channel(): string; new (...data: any[]): T },
        predicate: (message: T) => boolean
    ): void
}

/**
 * Implements common implementation details of a {@link ListenerManager}
 *
 * If you're implementing {@link ListenerManager} directly, it may be helpful to extend this class
 */
export abstract class ListenerManagerImplementations<
    TransferringType extends Sendable,
    CustomData extends Array<any> = []
> {
    constructor(registry: Registry<TransferringType, CustomData>) {
        this.registry = registry
    }

    protected notifyListeners(data: TransferringType) {
        for (let i = 0; i < this.awaiters.length; i++) {
            const awaiter = this.awaiters[i]
            if (awaiter.channel === data.channel && awaiter.predicate(data)) {
                awaiter.resolve(data)

                this.awaiters.splice(i, 1)

                return
            }
        }

        this.listeners.get(data.channel!)?.forEach(callback => callback(data))
    }

    /**
     * Listen for data sent by the other side of this connection, the data's prototype is also changed automatically so you get an actual instance of the class back
     * @param channelClass The class you're expecting to receive
     * @param callback Called when the listener manager received data on this channel
     */
    listen<T extends TransferringType>(
        channelClass: { channel(): string; new (...data: any[]): T },
        callback: (data: T) => void
    ) {
        const channel = channelClass.channel()

        if (!this.listeners.has(channel)) {
            this.listeners.set(channel, new Set())
        }

        this.listeners.get(channel)!.add(callback as any)
    }

    /**
     * Stop listening for data on the other side of this connection
     * @param channelClass The class the callback expects to receive
     * @param callback The callback to unsubscribe
     */
    stopListening<T extends TransferringType>(
        channelClass: { channel(): string; new (...data: any[]): T },
        callback: (data: T) => void
    ) {
        const channel = channelClass.channel()

        if (!this.listeners.has(channel)) return

        this.listeners.get(channel)!.delete(callback as any)
    }

    /**
     * Returns a promise that gets resolved when message of the expected class gets received, allowing you to await messages from the other side of the connection
     *
     * Only one awaiter can receive a message
     * The priority of who gets what is decided by who called awaitMessage first
     * A message can't trigger listeners if it's captured by a call of awaitMessage
     *
     * @param channelClass The class representing the data you want to await
     * @param predicate Decides whether you want the promise to get resolved for the given channelClass
     * @returns A promise that gets resolved when a message comes in that matches the channelClass and predicate
     */
    awaitMessage<T extends TransferringType>(
        channelClass: { channel(): string; new (...data: any[]): T },
        predicate: (message: T) => boolean
    ) {
        return new Promise((resolve, reject) => {
            this.awaiters.push({
                channel: channelClass.channel(),
                predicate: predicate as unknown as (data: Sendable) => boolean,
                resolve: resolve,
            })
        })
    }

    protected listeners: Map<string, Set<(data: TransferringType) => void>> =
        new Map()

    protected awaiters: Array<Awaiter> = []

    protected registry: Registry<TransferringType, CustomData>
}

/**
 * A class to provide the common implementation details for classes managing communication using this API
 *
 * ### HOW TO IMPLEMENT:
 * You must call `this.onData` whenever the implementor received data from the other end of the connection
 *
 * You must call `this.ready` when the connection becomes open and you're ready to transmit data
 *
 * `encode` & `decode` only need to faithfully encode and decode the data given to it, everything else is handled by the ListenerManager class.
 * For example, if the `IOType` is json encoded text, just using `JSON.parse` & `JSON.stringify` would work just fine
 *
 * `finalize` is passed in the type checker, and is responsible for type checking the data given to it.
 * It must also faithfully convert the `IntermediateType` to the `TransferringType`.
 * Prototype changes are handled automatically
 * For example, if the IOType is JSON encoded text, and the IntermediateType is the return value of JSON.parse, then simply running the type checkers, throwing an error if they fail, and returning the same value is good enough.
 *
 * @typeParam `TransferringType` The data type that users of the implementing manager would receive and send
 * @typeParam `IntermediateType` The type that `decode` will decode to, and that `finalize` will convert from.
 * This is useful for being able to get a channel out of data, without decoding the data to it's final state.
 * That's useful for type checking data to make sure it *can* be decoded to it's final state before it is.
 * @typeParam `IOType` The data type that this manager converts `TransferringType` to and from, and is what's sent over the network
 * @typeParam `CustomData` Defines what custom data the `finalize` method should take in, this data is given when the class uses the {@link MakeSendableWithData} decorator
 * Typically used for extra class specific decoding if neccesary, but it can be used for anything. Undefined by default
 */
export abstract class AbstractListenerManager<
        TransferringType extends Sendable,
        IntermediateType,
        IOType,
        CustomData extends Array<any> = []
    >
    extends ListenerManagerImplementations<TransferringType, CustomData>
    implements ListenerManager<TransferringType>
{
    constructor(registry: Registry<TransferringType, CustomData>) {
        super(registry)
    }

    /**
     * Implementors must call this function when they receive data from the other end of the network
     * @param data The data received
     */
    protected onData(data: IOType) {
        let intermediate: IntermediateType
        let channel: any

        try {
            ;[channel, intermediate] = this.decode(data)
        } catch (e) {
            console.warn(
                `Dropped message because decoder threw an error: \n ${e} \n\n ${data}`
            )
            return
        }

        if (typeof channel !== "string") {
            console.warn(
                `Dropped message since \`channel\` is not a string: \n ${intermediate} \n\n ${data}`
            )

            return
        }

        if (!this.registry.entries.has(channel)) {
            console.warn(
                `Dropped message because it's channel (${channel}) isn't included in the registry (did you remember to use @MakeSendable on it?): \n ${intermediate} \n\n ${data}`
            )

            return
        }

        const [classType, strats, customData] =
            this.registry.entries.get(channel)!

        let decoded: TransferringType

        try {
            decoded = this.finalize(intermediate, strats, ...customData)
        } catch (e) {
            console.warn(
                `Dropped message because converting to the TransferringType failed: ${e}: \n ${intermediate} \n\n ${data}`
            )

            return
        }

        Object.setPrototypeOf(intermediate, classType.prototype)

        this.notifyListeners(decoded)
    }

    /**
     * Send data to the other side of the network
     * @param data The data to send
     */
    send<T extends TransferringType>(data: T) {
        if (!this.registry.entries.has(data.channel!)) {
            throw new Error(
                "The class being sent isn't registered in the registry, did you remember to use @MakeSendable on it?"
            )
        }

        if (!this.isReady) {
            this.queue.push(data)
            return
        }

        data.channel = Object.getPrototypeOf(data).channel

        let encoded: IOType

        try {
            encoded = this.encode(data)
        } catch (e) {
            throw new Error(`The data being sent couldn't be encoded: ${e}`)
        }

        this.transmit(encoded)
    }

    private queue: Array<TransferringType> = []
    private isReady = false

    /**
     * Implementors must call this when the listener manager is ready to transmit data
     *
     * Before this is called, messages send by `send` are queued so they won't cause errors
     */
    protected ready() {
        this.isReady = true

        this.queue.forEach(v => this.send(v))

        this.queue = []
    }

    /**
     * Encode data from the `TransferringType` to the `IOType`
     * @param data The data to encode
     */
    protected abstract encode(data: TransferringType): IOType

    /**
     * Decode data from the `IOType` to the `IntermediateType`
     * @param data The data to decode
     * @returns A tuple where the first value is the channel, and the second value is the decoded type
     */
    protected abstract decode(data: IOType): [any, IntermediateType]

    /**
     * Transmit data to the other side of the network connection
     * @param data The data to transmit
     */
    protected abstract transmit(data: IOType): void

    /**
     * Type check and do final conversions for your `IntermediateType`
     * @param data The data returned from `decode`
     * @param typeChecker The predicate to ensure the data is the type expected, you're responsible for calling this
     * @param customData Any custom data provided when using {@link MakeSendableWithData}
     */
    protected abstract finalize(
        data: IntermediateType,
        typeChecker: (data: any) => boolean,
        ...customData: CustomData
    ): TransferringType
}

/**
 * A class to provide the common implementation details for classes managing communication using this API
 * This class encodes data in JSON.
 * If you want to use a different encoder, extend {@link AbstractListenerManager} instead
 * If you don't want an encoder at all, extends {@link InternalListenerManager} instead
 *
 * HOW TO IMPLEMENT:
 * You must call `this.onData` whenever the implementor received data from the other end of the connection
 *
 * You must call `this.ready` when the connection becomes open and you're ready to transmit data
 *
 * `transmit` must send the encoded data to the other side of the connection
 */
export abstract class JSONListenerManager extends AbstractListenerManager<
    Sendable,
    object,
    string
> {
    protected encode(data: Sendable) {
        return JSON.stringify(data)
    }

    protected decode(data: string): [any, object] {
        const decoded = JSON.parse(data)

        return [decoded.channel, decoded]
    }

    protected finalize(
        data: object,
        typeCheckingLayers: (data: any) => boolean
    ) {
        if (!typeCheckingLayers(data)) {
            throw new Error("Type checking failed")
        }

        return data as Sendable
    }
}

/**
 * A class to provide the common implementation details for classes managing communication using this API
 * This class doesn't encode data at all, and uses the transmitting type as the IO type
 * This is helpful for dealing with web workers, or sending notifications about internal state changes
 *
 * HOW TO IMPLEMENT:
 * You must call `this.onData` whenever the implementor received data from the other end of the connection
 *
 * You must call `this.ready` when the connection becomes open and you're ready to transmit data
 *
 * `transmit` must send the data to the other side of the connection
 */
export abstract class InternalListenerManager
    extends ListenerManagerImplementations<Sendable>
    implements ListenerManager<Sendable>
{
    constructor(registry: Registry<Sendable>) {
        super(registry)
    }

    /**
     * Implementors must call this function when they receive data from the other end of the network
     * @param data The data received
     */
    protected onData(data: Sendable) {
        let channel: any = data.channel

        if (!this.registry.entries.has(channel)) {
            console.warn(
                `Dropped message because it's channel (${channel}) isn't included in the registry (did you remember to use @MakeSendable on it?):\n ${data}`
            )

            return
        }

        this.notifyListeners(data)
    }

    /**
     * Send data to the other side of the network
     * @param data The data to send
     */
    send<T extends Sendable>(data: T) {
        if (!this.registry.entries.has(data.channel!)) {
            throw new Error(
                "The class being sent isn't registered in the registry, did you remember to use @MakeSendable on it?"
            )
        }

        if (!this.isReady) {
            this.queue.push(data)
            return
        }

        data.channel = Object.getPrototypeOf(data).channel

        this.transmit(data)
    }

    private queue: Array<Sendable> = []
    private isReady = false

    /**
     * Implementors must call this when the listener manager is ready to transmit data
     *
     * Before this is called, messages send by `send` are queued so they won't cause errors
     */
    protected ready() {
        this.isReady = true

        this.queue.forEach(v => this.send(v))

        this.queue = []
    }

    /**
     * Transmit data to the other side of the network connection
     * @param data The data to transmit
     */
    protected abstract transmit(data: Sendable): void
}

/**
 * A decorator to make a class sendable via a ListenerManager
 * @param registry The registry to put this class in
 * @param channel The channel this class should be sent through
 * @param strategy The strategy for type checking the values sent representing this class, in case someone sends invalid information to the server
 * @param customData The custom data to give to the decoder
 */
export function MakeSendable<
    T extends Sendable,
    CustomData extends Array<any> = []
>(
    registry: Registry<T, CustomData>,
    channel: string,
    strategy: (data: any) => boolean,
    ...customData: CustomData
) {
    return (constructor: { new (...args: any[]): T; channel(): string }) => {
        constructor.prototype.channel = channel

        registry.register(constructor, strategy, customData)
    }
}

/**
 * A factory that makes a decorator that acts like {@link MakeSendable} but without having to include the registry every time
 * @param registry The registry to put classes in
 * @returns A decorator that can be used in the same way as {@link MakeSendable}
 */
export function makeCustomSendableDecorator<
    T extends Sendable,
    CustomData extends Array<any> = []
>(
    registry: Registry<T, CustomData>
): <S extends T>(
    channel: string,
    strategy: (data: any) => boolean,
    ...data: CustomData
) => (constructor: { new (...args: any[]): S; channel(): string }) => void {
    return (
        channel: string,
        strategy: (data: any) => boolean,
        ...data: CustomData
    ) => {
        return MakeSendable(registry, channel, strategy, ...data)
    }
}
