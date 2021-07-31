# Triangulum

Triangulum is a lightweight, reactive, typescript API that makes the transfer of data as easy as possible by abstracting receiving and sending json strings over websockets or HTTP, buffers over TCP, or anything else you can encode and decode data from, into sending and receiving class instances via listeners.

## How it works

Triangulum uses some simple ideas to make it as flexible as possible

A `Registry` is a class that stores the prototypes of various classes, so object's prototypes can be changed to that of the target class.
It also stores the channel of each class. The channel is used to differentiate different incoming data types.
It also stores the type checkers for that class, which are used to ensure arbitrary unknown data is the correct type.
It can also store any arbitrary data you like for each class, typically functions that do extra decoding steps, but it can really be anything.

A `ListenerManager` is an interface that provides an API for sending classes around.
You must implement the interface yourself, and the easiest way to do that is to extend `AbstractListenerManager`, which does much of the hard work that comes with implementing the APIs.

`@MakeSendable` is a decorator that registers a class to a registry, using it is much more convenient than registering the class yourself. It's usually a good idea to make your own decorator that calls `@MakeSendable` or `@MakeSendableWithData` internally to add the extra convenience of not having to specify the registry, and also if you have your own class you want to make classes extend

The `strats` object tries to make writing type checkers for all kinds of data as easy and convenient as possible by providing a bunch of default type checkers for all kinds of data, which can be combined to type check almost anything. If the options in `strats` are insufficient, you can still always just input your own predicates

## Example

Here's an example using websockets:

```typescript
import {
    Sendable,
    AbstractListenerManager,
    MakeSendable,
    strats,
} from "triangulum"

// Create the registry that will be used to store all types that can be sent
const websiteRegistry = new Registry<Sendable, [(data: any) => boolean]>()

class ClientConnectionManager extends AbstractListenerManager<
    Sendable, // The class that all data being sent through must extend, making this something other than `Sendable` would be good for requiring that classes include certain methods
    object, // The data type that `decode` decodes to
    string, // The data type that `encode` encodes to, and is what should be given to `transmit`
    [(data: any) => boolean] // The data type expected from each class's type checkers
> {
    constructor() {
        super(websiteRegistry)

        this.ws = new WebSocket(`ws://${location.host}/ws`)

        this.ws.onmessage = e => {
            if (!(typeof e.data === "string")) return

            // Tell the AbstractListenerManager that some data has been received
            this.onData(e.data as string)
        }

        this.ws.onopen = e => {
            // Tell the AbstractListenerManager that this instance is ready to send messages
            // This is neccessary because the parent class caches messages to allow for instantiating the class and sending stuff immediately
            this.ready()
        }
    }

    // Defines how to encode the data being sent
    encode(dataObj: Sendable) {
        return JSON.stringify(dataObj)
    }

    // Defines how to decode data being received, must also give the channel
    decode(data: string): [string, object] {
        const parsed = JSON.parse(data)

        return [parsed.channel, parsed]
    }

    // Defines how the data should be sent
    transmit(data: string) {
        this.ws.send(data)
    }

    // Defines how to do type checking, as well as doing extra decoding if neccesary
    finalize(data: object, typeCheckers: [(data: any) => boolean]) {
        if (!typeCheckers[0](data)) {
            throw new Error("Type checking failed")
        }

        return data as Sendable
    }

    ws
}

const clientConnectionManager = new ClientConnectionManager()

// @MakeSendable registers the class to the registry, it takes the channel the class should be sent through, as well as how the data should be type checked.
@MakeSendable(websiteRegistry, "Thingy", [
    // The strats object contains helper methods to make writing these type checkers easier.
    strats.each({
        value: strats.string,
    }),
])
class Thingy extends Sendable {
    constructor(value: string) {
        this.value = value
    }

    value: string
}

// Send some data
clientConnectionManager.send(new Thingy("Hello world"))

// Listen for some data
clientConnectionManager.listen(Thingy, data => {
    alert(data.value)
})
```
