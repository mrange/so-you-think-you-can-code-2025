
# Bringing .NET’s Task Parallel Library (TPL) to TypeScript

**AI Transparency and Source Note:** I used an AI assistant to help polish the text and code comments in this post. The underlying `Task<T>`, `CancellationToken`, and `TaskFactory` code is based on modules I originally developed and currently maintain in the [MagnusThor/dathor-helpers](https://github.com/MagnusThor/dathor-helpers) package, but has been extracted, cleaned, and simplified here for presentation as a robust, standalone solution


**Welcome to Day 10 of the _So You Think You Can Code?_ 2025 Advent Calendar!**

Today, we address a challenge familiar to many TypeScript developers: managing complex asynchronous workflows in the browser. While native Promises are powerful, they often lack the structured control flow found in environments like .NET.

Developers coming from C# frequently miss the **Task Parallel Library (TPL)**—specifically the ability to track task states (`Running`, `Faulted`, `Canceled`) and the utility of a `CancellationToken` for gracefully stopping operations. In standard JavaScript, a Promise is typically "fire-and-forget," making cancellation and detailed status tracking cumbersome.

To bridge this gap, we present a robust, standalone implementation of `Task<T>`. This solution brings explicit state management, cooperative cancellation, and managed parallelism (via Web Workers) to TypeScript applications.

## 1. The Foundation: `Task.ts`

This module defines the core `Task<T>` class, which wraps a native Promise and exposes a controlled state machine. This allows for clear lifecycle visibility.

### The Lifecycle

A `Task` transitions through specific states, giving developers precise control over their application logic.

```ts
// --- File: Task.ts ---

/**
 * Represents the lifecycle state of a task.
 * @public
 */
export enum TaskStatus {
    Created = "Created",
    Running = "Running",
    Faulted = "Faulted",
    Canceled = "Canceled",
    RanToCompletion = "RanToCompletion",
}

/**
 * Represents a Task that encapsulates asynchronous operations, similar to .NET's Task class.
 * @template T The type of the result produced by this Task.
 */
export class Task<T> implements PromiseLike<T> {
    private readonly internalPromise: Promise<T>;
    
    private currentStatus: TaskStatus = TaskStatus.Created;
    private resultValue: T | undefined;
    private error: any | undefined;

    /** Gets the current execution status of the Task. */
    public get status(): TaskStatus {
        return this.currentStatus;
    }

    /** Provides access to the internal Promise for coordination by TaskFactory. */
    public get promise(): Promise<T> { 
        return this.internalPromise;
    }

    /**
     * Gets the result of the Task. Throws if the Task is not RanToCompletion.
     * @returns {T} The result value.
     */
    public get result(): T {
        if (this.currentStatus === TaskStatus.RanToCompletion) {
            return this.resultValue as T;
        }
        if (this.currentStatus === TaskStatus.Faulted) {
            throw this.error;
        }
        if (this.currentStatus === TaskStatus.Canceled) {
            throw new OperationCanceledError("Cannot access result of a Canceled Task.");
        }
        
        throw new Error(`Task has not completed successfully. Current status: ${this.currentStatus}`);
    }

    constructor(
        executor: (resolve: (value: T) => void, reject: (reason?: any) => void) => void
    ) {
        this.currentStatus = TaskStatus.Running; 
        
        this.internalPromise = new Promise<T>((resolve, reject) => {
            try {
                executor(
                    (value) => {
                        this.resultValue = value;
                        this.currentStatus = TaskStatus.RanToCompletion;
                        resolve(value);
                    },
                    (reason) => {
                        this.error = reason;
                        if (reason instanceof OperationCanceledError) {
                            this.currentStatus = TaskStatus.Canceled;
                        } else {
                            this.currentStatus = TaskStatus.Faulted;
                        }
                        reject(reason);
                    }
                );
            } catch (e) {
                this.error = e;
                if (e instanceof OperationCanceledError) {
                    this.currentStatus = TaskStatus.Canceled;
                } else {
                    this.currentStatus = TaskStatus.Faulted;
                }
                reject(e);
            }
        });
    }

    /** Creates a continuation that executes when the task completes. */
    public continueWith<TNew>(continuation: (task: Task<T>) => TNew | PromiseLike<TNew>): Task<TNew> {
        return new Task<TNew>((resolve, reject) => {
            this.internalPromise.then(
                () => {
                    try {
                        Promise.resolve(continuation(this)).then(resolve, reject);
                    } catch (e) {
                        reject(e);
                    }
                },
                () => {
                    try {
                        Promise.resolve(continuation(this)).then(resolve, reject);
                    } catch (e) {
                        reject(e);
                    }
                }
            );
        });
    }

    /** Attaches callbacks for the resolution and/or rejection of the Task (PromiseLike implementation). */
    public then<TResult1 = T, TResult2 = never>(
        onfulfilled?: ((value: T) => TResult1 | PromiseLike<TResult1>) | null | undefined,
        onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | null | undefined
    ): Promise<TResult1 | TResult2> {
        return this.internalPromise.then(onfulfilled, onrejected);
    }
}

```

## 2. Cooperative Cancellation: `CancellationToken.ts`

This module defines the `CancellationTokenSource` and `CancellationToken` pattern, enabling graceful termination of long-running operations.

```ts
// --- File: CancellationToken.ts ---

/** Custom error thrown when a Task is canceled via a CancellationToken. */
export class OperationCanceledError extends Error {
    constructor(message: string = "The operation was canceled.") {
        super(message);
        this.name = "OperationCanceledError";
        Object.setPrototypeOf(this, OperationCanceledError.prototype);
    }
}

/** Represents a token that is observed by an operation to check for cancellation requests. */
export class CancellationToken {
    private _isCancellationRequested: boolean = false;
    private _callbacks: (() => void)[] = [];

    /** Gets a value indicating whether cancellation has been requested for this token. */
    public get isCancellationRequested(): boolean {
        return this._isCancellationRequested;
    }

    /** Internal method called by CancellationTokenSource to signal cancellation. */
    public _signalCancel(): void {
        if (!this._isCancellationRequested) {
            this._isCancellationRequested = true;
            this._callbacks.forEach(callback => {
                try {
                    callback();
                } catch (e) {
                    console.error("Error executing cancellation callback:", e);
                }
            });
            this._callbacks = [];
        }
    }

    /** Registers a callback function to be executed when cancellation is requested. */
    public register(callback: () => void): void {
        if (this._isCancellationRequested) {
            callback();
        } else {
            this._callbacks.push(callback);
        }
    }

    /** Throws an OperationCanceledError if cancellation has been requested. */
    public throwIfCancellationRequested(): void {
        if (this._isCancellationRequested) {
            throw new OperationCanceledError("The operation was canceled.");
        }
    }
}

/** The source of a cancellation token. Allows external components to request cancellation. */
export class CancellationTokenSource {
    /** The token associated with this CancellationTokenSource. */
    public readonly token: CancellationToken;

    constructor() {
        this.token = new CancellationToken();
    }

    /** Signals a request for cancellation to the associated CancellationToken. */
    public cancel(): void {
        this.token._signalCancel();
    }
}

```

## 3. Managed Parallelism: `WorkerTask.ts`

This module wraps the native Web Worker API, making it feel like a standard `Task<T>`.


```ts
// --- File: WorkerTask.ts ---

/**
 * A managed worker task helper that allows dispatching async functions to a dedicated Worker.
 * Requires CancellationToken and Task.
 */
export class WorkerTask {
    private nextId = 0;
    private pending = new Map<
        number,
        { resolve: (value: any) => void; reject: (reason: any) => void }
    >();

    constructor(public readonly worker: Worker) { 
        this.worker.onmessage = this.handleMessage.bind(this);
        this.worker.onerror = this.handleError.bind(this);
    }

    private handleMessage(e: MessageEvent) {
        const { id, result, error } = e.data;
        const entry = this.pending.get(id);
        if (!entry) return;
        this.pending.delete(id);

        if (error) {
            entry.reject(new Error(error));
        } else {
            entry.resolve(result);
        }
    }

    private handleError(e: ErrorEvent) {
        for (const [, entry] of this.pending.entries()) {
            entry.reject(new Error(e.message));
        }
        this.pending.clear();
    }

    /**
     * Dispatches a worker-side function by name, passing args as structured clone data.
     */
    public dispatchWorkerAction<T>(
        functionName: string,
        args: any,
        transfer?: Transferable[],
        token?: CancellationToken
    ): Task<T> {
        return new Task<T>((resolve, reject) => {
            if (token?.isCancellationRequested) {
                reject(new OperationCanceledError("Worker task was canceled before dispatch."));
                return;
            }

            const id = this.nextId++;
            this.pending.set(id, { resolve, reject });
            try {
                this.worker.postMessage({ id, functionName, args }, transfer ? transfer : undefined);
            } catch (err) {
                this.pending.delete(id);
                reject(err);
            }
            token?.register(() => {
                this.worker.postMessage({ cancel: id });
                reject(new OperationCanceledError("Worker task was canceled."));
            });
        });
    }

    public terminate(): void {
        this.worker.terminate();
    }
}

```

----------

## 4. Task Coordination: `TaskFactory.ts`

This module provides static methods for orchestration, including `whenAll`, `whenAny`, and `parallelFor`, mirroring the key utilities of the .NET TPL.

```ts
// --- File: TaskFactory.ts ---

/** A factory class for creating and managing Task instances. */
export class TaskFactory {

    /** Creates a Task that has already completed successfully with the specified result. */
    public static fromResult<TResult>(result: TResult): Task<TResult> {
        return new Task<TResult>((resolve) => resolve(result));
    }

    /** Creates a Task that will complete when all of the Task objects in a collection have completed. */
    public static whenAll<TResult>(tasks: Task<TResult>[]): Task<TResult[]> {
        const promiseAll = Promise.all(tasks);

        return new Task<TResult[]>((resolve, reject) => {
            promiseAll.then(resolve, reject);
        });
    }

    /** Returns a Task that completes when any of the supplied tasks completes. */
    public static whenAny<TResult>(tasks: Task<TResult>[]): Task<Task<TResult>> {
        const promisesToRace = tasks.map(t =>
            (t as any).promise.then(() => t, () => t) as Promise<Task<TResult>>
        );

        const promiseRace = Promise.race<Task<TResult>>(promisesToRace);

        return new Task<Task<TResult>>((taskResolve, taskReject) => {
            promiseRace
                .then(
                    (winningTask) => taskResolve(winningTask as Task<TResult>),
                    (reason) => taskReject(reason)
                )
                .catch(taskReject);
        });
    }


    /** Executes a for loop concurrently, where the body returns a Task<void> or void. */
    public static parallelFor(
        fromInclusive: number,
        toExclusive: number,
        body: (index: number) => Task<void> | void,
        token?: CancellationToken
    ): Task<void> {
        const tasks: Task<void>[] = [];

        if (token?.isCancellationRequested) {
            return new Task<void>((_resolve, reject) => reject(new OperationCanceledError("Parallel.For canceled immediately.")));
        }

        for (let i = fromInclusive; i < toExclusive; i++) {
            if (token?.isCancellationRequested) {
                break;
            }

            const result = body(i);

            if (result instanceof Task) {
                tasks.push(result);
            } else if (result !== undefined) {
                tasks.push(TaskFactory.fromResult(undefined));
            }
        }

        return new Task<void>((resolve, reject) => {
            TaskFactory.whenAll(tasks)
                .then(() => {
                    if (token?.isCancellationRequested) {
                        reject(new OperationCanceledError("Parallel.For completed, but was canceled during execution."));
                    } else {
                        resolve();
                    }
                })
                .catch(reject);
        });
    }

    /** Executes an array of arbitrary asynchronous actions concurrently and waits for all of them to complete. */
    public static Invoke(actions: (() => Task<void>)[]): Task<void> {
        const tasks = actions.map(action => action());

        return new Task<void>((resolve, reject) => {
            TaskFactory.whenAll(tasks)
                .then(() => resolve())
                .catch(reject);
        });
    }

    /** Executes a pre-defined CPU-bound function on a dedicated Web Worker thread. */
    public static RunWebWorkerTask<T>(manager: WorkerTask, functionName: string, args: any): Task<T> {
        console.log(`dispatchWorkerAction called on ${manager.constructor.name} with function ${functionName}`);
        return manager.dispatchWorkerAction<T>(functionName, args);
    }
    
    /**
     * Creates a Task that completes after a specified time interval, mimicking C#'s Task.Delay.
     * @param milliseconds The delay time in milliseconds.
     * @param value The value to resolve the task with (optional).
     * @param token An optional CancellationToken to cancel the delay.
     */
    public static delay<T>(milliseconds: number, value?: T, token?: CancellationToken): Task<T> {
        return new Task<T>((resolve, reject) => {
            if (token?.isCancellationRequested) {
                return reject(new OperationCanceledError("Delay canceled immediately."));
            }

            let timeoutId: any;
            
            const onCancel = () => {
                clearTimeout(timeoutId);
                reject(new OperationCanceledError("Delay was canceled."));
            };

            if (token) {
                token.register(onCancel);
            }

            timeoutId = setTimeout(() => {
                // In a more complex CancellationToken implementation, we would unregister the callback here.
                resolve(value as T);
            }, milliseconds);
        });
    }

    /**
     * Executes a synchronous function and returns a Task that represents its completion, mimicking C#'s Task.Run.
     */
    public static run<T>(action: () => T): Task<T> {
        return new Task<T>((resolve, reject) => {
            try {
                // Execute synchronously but resolve/reject asynchronously after the current call stack clears
                setTimeout(() => {
                    try {
                        resolve(action());
                    } catch (e) {
                        reject(e);
                    }
                }, 0);
            } catch (e) {
                // Catch errors thrown during the immediate setup of the Task
                reject(e);
            }
        });
    }
}

```


## 5. Practical Example: Monte Carlo $\pi$ Calculation

We demonstrate parallelism and cancellation by calculating $\pi$ using the Monte Carlo method, dividing the work across multiple threads.

### 5a. The Worker Code: `pi-worker.js`

This file contains the synchronous, CPU-bound logic and handles the messaging protocol established by `WorkerTask`. It must be compiled/bundled separately.

```js
// --- File: pi-worker.js ---
// NOTE: This runs in the dedicated Worker context.

// Assume CancellationToken and OperationCanceledError are defined/imported here
// e.g., import { CancellationToken, OperationCanceledError } from './CancellationToken.ts'; 

/**
 * Executes the Monte Carlo simulation for a given number of iterations.
 * @param {number} count The number of points to generate.
 * @param {CancellationToken} token The token to check for cancellation.
 */
function calculatePiSlice(count, token) {
    let pointsInsideCircle = 0;
    let totalPoints = count;

    for (let i = 0; i < count; i++) {
        // Cooperative cancellation check every 100,000 iterations
        if (i % 100000 === 0) {
            if (token && token.isCancellationRequested) {
                // In a real worker, you would need to throw an error that is 
                // handled by the messaging layer to signal cancellation.
                throw new Error("OperationCanceledError");
            }
        }

        const x = Math.random();
        const y = Math.random();
        
        if (x * x + y * y <= 1) {
            pointsInsideCircle++;
        }
    }

    return { inside: pointsInsideCircle, total: totalPoints };
}

// Global functions map for the WorkerTask system
const workerFunctions = {
    calculatePiSlice: calculatePiSlice
};

// Worker message handler implementation:
self.onmessage = (e) => {
    const { id, functionName, args, cancel } = e.data;

    if (cancel !== undefined) {
        // Handle external cancellation signal (optional, but good practice)
        // In a real system, you might store and check a global cancellation map.
        return; 
    }

    const func = workerFunctions[functionName];
    if (func) {
        try {
            // Note: CancellationToken must be serialized/reconstructed if needed, 
            // but here we assume the token is passed and checked.
            const result = func(args.count, args.token); 
            self.postMessage({ id, result });
        } catch (error) {
            // Send back the error message
            self.postMessage({ id, error: error.message });
        }
    }
};

```

### 5b. The Main Thread Code: `main.ts`

This is the main application logic, which orchestrates the parallel tasks and handles aggregation and cancellation.

```ts
// --- File: main.ts ---
// Assumes Task, CancellationTokenSource, WorkerTask, and TaskFactory are imported.

const totalIterations = 800_000_000;
const numTasks = 8;
const iterationsPerTask = totalIterations / numTasks;

// We use a single source to manage cancellation for all parallel tasks
const cts = new CancellationTokenSource();

async function runMonteCarloPi(workerManager: WorkerTask): Promise<number> {
    const calculationTasks: Task<{ inside: number, total: number }>[] = [];

    for (let i = 0; i < numTasks; i++) {
        const task = TaskFactory.RunWebWorkerTask(
            workerManager, 
            "calculatePiSlice", 
            { count: iterationsPerTask, token: cts.token } 
        );
        calculationTasks.push(task);
    }

    try {
        console.log(`Starting ${numTasks} parallel tasks for ${totalIterations} iterations...`);
        
        // Example of how to trigger cancellation externally:
        /*
        setTimeout(() => {
            cts.cancel(); 
            console.log("--- CANCELLATION REQUESTED after 1s ---");
        }, 1000); 
        */

        const results = await TaskFactory.whenAll(calculationTasks);

        // Aggregate results from all parallel tasks
        const totalInside = results.reduce((sum, r) => sum + r.inside, 0);
        const totalPoints = results.reduce((sum, r) => sum + r.total, 0);

        // Pi is approx (4 * points_in_circle) / total_points
        const piEstimate = (4 * totalInside) / totalPoints;
        console.log(`Final Pi Estimate: ${piEstimate}`);
        return piEstimate;
        
    } catch (e) {
        // Handle cancellation specifically
        if (e instanceof OperationCanceledError || e.message === "OperationCanceledError") {
            console.warn("Monte Carlo PI calculation was successfully canceled!");
            return NaN;
        }
        throw e;
    }
}

// Example Initialization and Run (requires local worker setup):
// const workerManager = new WorkerTask(new Worker('./pi-worker.js'));
// runMonteCarloPi(workerManager);

```

## 6. API in Action: Quick Examples

Here are some concise examples demonstrating key `Task` behaviors, including continuations and handling native `Promise`-based functions like `fetch()`.

### Example 6a: Chaining with `continueWith`

The `continueWith` method executes regardless of the preceding task's success or failure, allowing for clean result handling or cleanup.


```ts
// --- Snippet: continueWith ---

// 1. Create a task that resolves after 1 second
const t = new Task<number>((resolve, reject) => {
    // Note: If CancellationToken.ts is not imported, OperationCanceledError will not be defined.
    setTimeout(() => resolve(42), 1000); 
});

// 2. Attach a continuation that runs when 't' completes
const continuationTask = t.continueWith(task => {
    // Check status explicitly before accessing result
    if (task.status === TaskStatus.RanToCompletion) {
        console.log("Task finished successfully.");
        return `Result: ${task.result}`; // Returns a string result
    } else {
        console.error("Task failed or was canceled. Status:", task.status);
        return "Continuation Handled Error";
    }
});

continuationTask.then(result => console.log(result)); // Output after 1s: Task finished successfully. Result: 42

```

### Example 6b: Integrating with Native `fetch()`

A `Task` can easily wrap any native Promise, giving the operation a traceable status and allowing factory methods (like `whenAll`) to manage it.


```ts
// --- Snippet: Wrapping fetch() ---

function fetchAsTask(url: string, token: CancellationToken): Task<Response> {
    return new Task<Response>((resolve, reject) => {
        // Native AbortController is used to provide cancellation to fetch
        const controller = new AbortController();
        const signal = controller.signal;
        
        // Register the cancellation token to abort the fetch operation
        token.register(() => {
            controller.abort();
            reject(new OperationCanceledError("Fetch was aborted by CancellationToken."));
        });
        
        // Execute the native fetch operation
        fetch(url, { signal })
            .then(response => {
                if (response.ok) {
                    resolve(response);
                } else {
                    reject(new Error(`HTTP Error: ${response.status}`));
                }
            })
            .catch(error => {
                // If fetch was aborted, it throws a specific DOMException.
                // We re-throw our standardized error if it was canceled via the token.
                if (error.name === 'AbortError') {
                    // Assuming the rejection path above handled the cancellation
                    reject(new OperationCanceledError("Fetch was aborted."));
                } else {
                    reject(error);
                }
            });
    });
}

// Example usage:
// const ctsForFetch = new CancellationTokenSource();
// const dataTask = fetchAsTask("https://api.example.com/data", ctsForFetch.token);

```


## 7. Advanced Utility: Extending the Factory

This section introduces methods that significantly enhance the usability and control of the system. The `TaskFactory` is designed to be **highly extensible**, providing a centralized static interface where developers can easily add their own environment-specific task creation and coordination helpers. These two new methods fill out the base utility layer, making it simple to introduce controlled delays (`delay`) and wrap existing synchronous code (`run`).

### Example 7a: Non-Blocking Delay

This is the non-blocking equivalent of `Thread.Sleep()`, which can also be canceled.


```ts
// --- Snippet: Task.Delay ---

async function timedOperation() {
    console.log("Starting a 2-second wait.");
    
    // Task.delay is equivalent to await Task.Delay(2000) in C#
    const delayTask = TaskFactory.delay(2000, "Delay Finished");

    // We can observe the status while it's Running
    console.log(`Status at start: ${delayTask.status}`);

    const result = await delayTask;
    console.log(`Status at end: ${delayTask.status}`);
    console.log(`Result: ${result}`);
}

// timedOperation(); 
// Output: 
// Starting a 2-second wait.
// Status at start: Running
// (2 seconds later)
// Status at end: RanToCompletion
// Result: Delay Finished

```

### Example 7b: Synchronous Work as a Task

`TaskFactory.run` allows you to wrap a potentially CPU-intensive synchronous function, ensuring any exceptions are correctly captured and surfaced as a `Faulted` task.


```ts
// --- Snippet: Task.Run ---

function calculateSyncSum(n: number): number {
    if (n < 0) {
        throw new Error("Input must be positive.");
    }
    let sum = 0;
    for (let i = 0; i < n; i++) {
        sum += i;
    }
    return sum;
}

// Run a synchronous function inside a Task
const runTaskSuccess = TaskFactory.run(() => calculateSyncSum(100));

// Run a function that throws an error
const runTaskFailure = TaskFactory.run(() => calculateSyncSum(-1));

runTaskSuccess.then(result => {
    console.log("Run success:", result); // Output: Run success: 4950
});

runTaskFailure.catch(error => {
    console.error("Run failure:", error.message); // Output: Run failure: Input must be positive.
    console.log(`Failure Status: ${runTaskFailure.status}`); // Output: Failure Status: Faulted
});

```


## Wrapping Up

By adopting this "TPL-style" pattern in TypeScript, developers gain three primary benefits:

1.  **Visibility:** Clear insight into the exact state of an operation.
2.  **Control:** The ability to cancel operations cooperatively and safely.
3.  **Performance:** Simplified dispatching of work to background threads using a unified API.
    
Feel free to copy these classes into your utility files and start taking control of your asynchronous workflows.

Happy Coding, and see you in the next Advent Calendar entry!

