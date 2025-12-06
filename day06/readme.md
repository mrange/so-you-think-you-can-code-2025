# 🎄 Day 6: an asynchronous assembly adventure, on the game boy!

**By:** Shoofle

As a preface: This article assumes some familiarity with assembly, or a willingness to pick it up on the fly. The super ultra quick crash course on game boy sm83 assembly is this: 

- `ld a, b` means "copy the value from register `b` into register `a`" (note the order!)
- `ld [vCurrentSelection], a` means "copy the value from register `a` into RAM at memory address `vCurrentSelection`".
- Terms such as `vCurrentSelection` are statically allocated memory addresses, so they get substituted with raw immediate numbers at assembly time.
- A line beginning with, for ex., `MenuSetup:` is a label, which is essentially a constant that gets replaced at compile time by the memory address of the following line
- There are a few registers: `a`, `b`, `c`, `d`, `e`, `h`, and `l` are all 8-bit registers that can be used for various operations. you can also sometimes use the pairs `bc`, `de`, and `hl` as 16-bit registers, in addition to occasionally using the special pseudo-register-pairs `af` (`a` plus the processor's flag bits), `sp` (stack pointer), and `pc` (program counter)
- There's also a stack. The 16-bit register `sp` can be set and read, and interacts with the `push`, `pop`, `call`, and `ret` instructions.
- Most of the time I stick to passing variables through registers - a subroutine call requires loading values into the appropriate registers, then executing a `call` instruction to jump to the subroutine. Then the subroutine uses the `ret` instruction to return to the call site.
- `; semicolons for comments`

Picture it: You're writing a program for the nintendo game boy, in raw assembly, as you do. You want to initialize the menu screen, by setting a variable and loading graphical data to the screen. You've got two subroutines to use. `CopyTilesToMap` is used to copy a tile map (a list of tile IDs) from the ROM into the dedicated screen memory, so that the right tiles will be displayed on the screen. `CopyRange` is used to copy the pixel data from the ROM into the specific spot in VRAM so the game boy knows how to draw the tile IDs we copied before. They just walk over a range of bytes, copying them one by one to their specified destination. It's most important to know that these are functions we use to copy a range of data into VRAM.

So, you write this code:

```
MenuSetup:
	; set up whatever variables and memory the screen needs
	ld a, 0
	ld [vCurrentSelection], a

	; load the tile IDs into the background map	
	ld hl, Menu.UITileMap ; source tile map location in rom
	ld de, _SCRN0         ; destination is the start of the screen in memory
	ld b, 18              ; height (in tiles) 
	ld c, 20              ; width (in tiles) (takes up the full screen)
	call CopyTilesToMap
	
	; load the data for all the tiles used for drawing the screen
	ld hl, Menu.UITileData                      ; source
	ld de, _VRAM + $1000                        ; destination
	ld bc, Menu.UITileDataEnd - Menu.UITileData ; length of data
	call CopyRange
	
	ret
```

It's simple enough. First you set up whatever variables you need for the screen, then you use `CopyTilesToMap` to load the menu's tilemap, then you use `CopyRange` to load the data for what those tiles should look like. Seems good, right?

Wrong. The problem comes up immediately: The game boy CPU can't write to or read from graphics memory while the screen is drawing. You have to wait for the v-blank period, an extra ten scanlines' worth of processor time between every frame. Only during that time are you given access to load data into VRAM.

If you're like me, your first thought is "Okay, I'll make new versions of `CopyTilesToMap` and `CopyRange` that will safely restrict their activity to v-blank." They'll check between each byte transfer whether it's safe to copy data to VRAM, and otherwise they'll spin their wheels.

So if `CopyRange` looks like this:

```
CopyRange:
	if the length to copy is zero, return 
	copy the byte at the source address to the destination
	step the source address forward 
	step the destination address forward
	decrease the length to copy
	and jump to CopyRange
```

Then your new `CopyRangeSafely` will look like this:

```
CopyRangeSafely: 
	if the length to copy is zero, return 
	copy the byte at the source address to the destination
	step the source address forward 
	step the destination address forward
	decrease the length to copy
.checkIfDone:
	check if the game boy is in v-blank.
		if it is in v-blank, jump to CopyRangeSafely
		if it's not in v-blank, wait a few cycles and jump to .checkIfDone
```

Checking for v-blank ultimately increases the number of instructions by at least 30%, between juggling registers, making fetches, and making comparisons. Much worse, this solution freezes up the entire handheld in a busy loop until it's done copying! You struggle onwards for a bit before realizing this isn't tenable at all. So you sit and think.

If only there were some way to write the same code for v-blank-safe memory transfers as for other memory transfers. This `CopyRangeSafely` function is really eating at you. If there were some way to take any block of code, and guarantee that it only executes during v-blank, and pauses otherwise. What you'd really like is to be able to run game update code every frame outside of v-blank, and let your transfer code run during every v-blank until it's complete. 

But that sounds like having two different threads. Multi-threaded code is hard, right? And the game boy processor is famously weak, it doesn't even have a modulo instruction! And this is just a hobby project. And you have no experience writing OS-level code... 

But there's no harm in trying, eh? Maybe you could start by chipping away at the efficiency at least. So, what have you got available to you?
## a first attempt

The "safe" versions of the copy functions were slower, in part because they have to check - once for every byte copied - whether it's safe to do so. Is there any way you could get the processor to start and stop that behavior on its own, without having to do the checks yourself? Does the game boy processor even have a way to do that?

Well, the game boy has interrupts. Under certain conditions, as the processor is running, it will execute a `call` to a hard-coded address determined by the conditions - `$0060` if the joypad was pressed, `$0058` if a byte was received from the serial port, `$0050` if a timer rolled over... These addresses have just enough space to call or jump somewhere else to react to the interrupt. It just so happens that you can configure one of these interrupts to happen when the game boy enters v-blank, and another for when it starts drawing line zero and thus exits v-blank. It also supports a `halt` instruction, which suspends the CPU until an interrupt fires.

Maybe you can use these somehow.

For a start, you can use the interrupt to at least stop needing to check when the transfer is safe. Here's how it works: You `halt` execution. Then, configure the v-blank interrupt to wake up the processor and continue what it's doing. Then it'll run some of your code. Then another interrupt, when the device exits v-blank and it's no longer safe to copy, will execute another `halt` instruction, to put it to sleep until the next v-blank period.

Maybe that could work. Then you could at least get rid of the slow and ugly `CopyRangeSafe` functions. So how does this look?

We want to run the `MenuSetup` subroutine from above. The changes here are simple:

```
MenuSetup:
	; set up some statically allocated screen variables
	ld a, 0
	ld [vCurrentSelection], a
	
+	call SetUpInterrupts ; turn on interrupts and set up the handler
+	halt                 ; wait until the next interrupt

	ld hl, Menu.UITileMap ; tile map location in rom
	ld de, _SCRN0         ; draw it starting at 0,0 on the screen
	ld b, 18              ; height (in tiles) 
	ld c, 20              ; width (in tiles) (takes up the full screen)
	call CopyTilesToMap
	
	; load the data for all the tiles used for drawing the screen
	ld hl, Menu.UITileData                      ; source
	ld de, _VRAM + $1000                        ; destination
	ld bc, Menu.UITileDataEnd - Menu.UITileData ; length of data
	call CopyRange

+	call TearDownInterrupts
	
	ret
```

`SetUpInterrupts` will clear the interrupt flags, enable the specific interrupts we want, enable interrupts globally, set the STAT interrupt to fire on scanline zero, and do whatever busywork needs to happen to connect the interrupt vectors (those hardcoded ROM addresses for each interrupt) to the code that you're writing. The [pandocs](https://gbdev.io/pandocs/Interrupts.html) will help you here. Likewise, `TearDownInterrupts` will disable the two interrupt handlers we're using to restore the regular flow of code.

Then you'll have the two interrupt handlers, one for when we're entering v-blank and one for when we're exiting, which get hooked up by `SetUpInterrupts`. After that `halt` instruction, the processor is going to wait until an interrupt happens. What should the interrupt handlers look like?

When the device enters the v-blank period, nothing needs to happen, because the interrupt firing at all will wake the processor up. So it just needs to enable interrupts again (the processor turns off interrupts globally when it starts handling an interrupt) and return the processor to its previous work.

```
VBlankInterrupt:
	ei  ; enable interrupts
	ret ; return to wherever the processor was before the interrupt fired
```

When it reaches scanline zero, the [configurable STAT interrupt](https://gbdev.io/pandocs/Interrupt_Sources.html#int-48--stat-interrupt) (set up in `SetUpInterrupts`) fires. It should enable interrupts, then execute a `halt` instruction to put the CPU to sleep.

```
STATInterrupt:
	ei   ; enable interrupts
	halt ; sleep processor until next interrupt
	ret  ; return to wherever the processor was before the interrupt fired
```

So the execution goes like this:
1. Our `MenuSetup` routine runs the first bit, doing synchronous normal code, setting up variables, and such. Everything for which it doesn't need to touch VRAM.
2. It calls `SetUpInterrupts`, which does the busywork of setting and enabling the v-blank interrupt and STAT interrupt.
3. It then halts, which puts the processor to sleep until...
4. The v-blank interrupt we set up in step 2 fires, waking up the processor. It immediately returns...
5. And starts executing the code in `MenuSetup` that touches VRAM. That code runs for a bit until...
6. When the game boy starts drawing scanline zero of the screen, the STAT interrupt we also set up in step 2 fires, which executes a `halt` to put the processor to sleep, until...
7. The v-blank interrupt fires again, waking up the processor. It immediately returns...
8. Continuing execution of the `MenuSetup` code from where we left off in step 5, until...
9. The STAT interrupt fires, putting the processor to sleep until...
10. The v-blank interrupt fires again, waking up the processor. It returns...
11. Continuing execution of the `MenuSetup` code from where it left off in step 8, until...
12. _And so on!_

So what did all this (a few helper functions and two interrupts) net you? Well, now you don't need to have special `CopyRangeSafely` functions, and it'll run much faster without the overhead of checking all the time whether it's safe. I think we can feel pretty good about that! 

But most of all, you've learned a bit about the idea of using interrupts to enter and exit a specific "safe" period in the game loop. We're using the v-blank interrupt to enable our code to run, and the STAT interrupt to take control away and stop it again, so that the code that needs to run exclusively in v-blank can look the same as code that can run whenever, without changes!

## a second attempt

But that first attempt doesn't solve the problem of interleaving other code with the `CopyRange` operation. Your program will now sleep whenever it's not able to copy data. But you wonder: is it possible to use that time, when the program is sleeping, to run something else at the same time? To use the interrupts to switch between two simultaneous "threads" of code being executed?

Well, what's the state of the processor at any given moment? Ignore the RAM for now, which should be shared between threads.
1. There's the registers it uses to pass information around - `af`, `bc`, `de`, and `hl`. 
2. There's the program counter `pc`, which indicates the specific line being executed. 
3. And there's the stack pointer `sp` which holds the address of the variable stack of data used to store call and return locations. 
Could we somehow... keep two copies of all of those? You could certainly define dedicated memory locations to store all the registers. 

The issue is the stack and the program counter. The stack is used for holding some data (`push` and `pop` will put register pairs on and take them off) and for tracking the call stack - used to remember where to resume when you `ret`urn from a subroutine, or from an interrupt.

In my experiments (particular to my code) the call stack only got four or five calls deep, and I wasn't ever putting much data on it. So it'd be easy enough to allocate space for a second call stack, and then freely set the stack pointer `sp` to whatever you want.

The program counter isn't generally manipulated directly, except by `jp` (jump), `call`, and `ret` instructions. Pretend we can just read and write from and to it.

Maybe you could do as before, and write a v-blank handler to swap all of that context out, and a STAT handler to swap back... That might work! First, some starting assumptions:

Your goal is to be able to say "hey, processor, run this other subroutine whenever it's safe to do so", and then the processor will handle scheduling its execution while you can go on and continue doing other stuff. You'll have to write a function to set up the interrupts to execute our asynchronous code. The point of this is to be able to write normal-looking code, so we'll make a new function `RunInVBlank` that will execute a specified subroutine (passed in `hl`) in the "safe" part of each frame. 

So your new `MenuSetup` subroutine would break up into a part that runs immediately:

```
MenuSetup:
	; do whatever synchronous stuff we want to do in the setup
	; like initializing variables for this screen.
	ld a, 0
	ld [vCurrentSelection], a ; example!
	
+	ld hl, MenuSetupVRAMPart ; pass the subroutine we want as an argument
+	call RunInVBlank
	ret
```

And a second part, which gets scheduled to only be running when VRAM is safe to access:

```
MenuSetupVRAMPart:
	ld hl, Menu.UITileMap ; tile map location in rom
	ld de, _SCRN0         ; draw it starting at 0,0 on the screen
	ld b, 18              ; height (in tiles) 
	ld c, 20              ; width (in tiles) (takes up the full screen)
	call CopyTilesToMap
	
	; load the data for all the tiles used for drawing the screen
	ld hl, Menu.UITileData                      ; source
	ld de, _VRAM + $1000                        ; destination
	ld bc, Menu.UITileDataEnd - Menu.UITileData ; length of data
	call CopyRange
	
	ret
```

Then the normal flow of execution is that `MenuSetup` does its stuff, updates variables, calls `RunInVBlank` to schedule its subroutine for execution in v-blank, and then returns to do whatever else the main game loop wants done. When the v-blank period arrives, an interrupt will fire and switch contexts to execute a bit of the `MenuSetupVRAMPart`. When the v-blank period ends, another interrupt fires and context switches back to the main game loop, and things continue in this way, switching back and forth between the "main thread" and the execution of `MenuSetupVRAMPart`.

Now it's a matter of figuring out what that mysterious `RunInVBlank` subroutine will do. First off, you need to keep a separate copy of our registers. Define some static memory addresses wherever you do that: `vAsyncAF`, `vAsyncBC`, `vAsyncDE`, `vAsyncHL`, `vAsyncSP`, `vAsyncPC`. Next up, the stack: by default, the stack grows down from `$FFFF`. If your async stack starts at `$FFBF`, that will leave 64 bytes out of the special HRAM memory region (`$FF80`-`$FFFF`) for each stack. (Note: If we wanted to, we could configure our stacks to be anywhere in RAM, which would enable them to grow much bigger. I opted not to do this, because I'm a silly goose.)

`RunInVBlank` needs to set up that parallel execution environment (give all those registers starting values), and then enable the handler for entering v-blank. (Note: I'm also going to take some liberties and pretend there are a few extra instructions the game boy doesn't actually support, like using `ld` to put two-byte values into memory addresses. Rewriting this to use the available asm instructions is a pain but it's doable.)

```
RunInVBlank:
	; store starting values for the registers
	ld [vAsyncAF], af
	ld [vAsyncBC], bc
	ld [vAsyncDE], de
	ld [vAsyncHL], hl
	
	; store starting value for the stack pointer
	ld [vAsyncSP], $FFBF
	
	; store starting value for the program counter, passed as arg in hl
	ld [vAsyncPC], hl
	
	; enable v-blank interrupt
	ld hl, rIE            ; target the interrupt enable flag
	set B_IE_VBLANK, [hl] ; set the bit to enable the v-blank interrupt
	ei                    ; enable interrupts globally
	
	ret
```

So you store the starting values for the registers, you set the starting value for the stack pointer, and you store the program counter we want to start from. Ezpz! Then what's the v-blank handler look like? It's gotta stash all the context info from the main thread, and unstash all the context info for the async thread.

```
VBlankInterrupt:
	; store current values of the registers
	ld [vMainAF], af ; stash af registers
	ld [vMainBC], bc 
	ld [vMainDE], de
	ld [vMainHL], hl
	
	; store current value of the stack pointer
	ld [vMainSP], sp
	
	; store the current program counter
	ld [vMainPC], pc ; hmm....
	
	; get last values of the async registers
	ld af, [vAsyncAF]
	ld bc, [vAsyncBC]
	ld de, [vAsyncDE]
	ld hl, [vAsyncHL]
	
	; get last value of the stack pointer
	ld sp, [vAsyncSP]
	
	; get last program counter
	ld pc, [vAsyncPC] ; hmm...
	
	ret
```

And then you can write a `STATInterrupt` that should do the inverse, storing the async registers and fetching the main registers. These are context-switching interrupts! When the interrupt fires to signal the game boy is in the "safe" period, it switches context from main to async, and when the interrupt fires to signal we're out of the safe period, it switches context back.

But there's a big problem: we've been very cavalier with the program counter. On the line where I've commented `hmm...` we read from the program counter to get the state of the main thread. If `VBlankInterrupt` tries to store the current address of execution, it's not going to be where to resume the main thread - it's going to be inside `VBlankInterrupt`! Ditto for the `hmm!` line - writing directly to the program counter would mess up all sorts of things! When you want to interact with the program counter, you really need to use `jp` or `call` or `ret` instructions.

One more try.
## a third attempt

The problems with `pc` are big. The approach above falls apart completely and is a huge pain to implement. Fret not, though, for we are valiant. The issue is in getting and storing information about where the processor is currently executing - you can't just read and write `pc`willy-nilly. But how does the processor handle that information? Well, it puts it on the stack! It's time to talk about the call stack, how it interacts with interrupts, and you.

The call stack works like this: the stack pointer `sp` always contains a memory address. It's initialized to `$FFFE`, the second-to-last memory address, at processor start-up. Whenever a `push` instruction is executed (`push hl`), the stack pointer `sp` is decreased by two bytes, and the register pair is copied into the new location `sp` points to (like `ld [sp], hl`). When a `pop` instruction is executed (`pop hl`), the memory at `sp` is copied into the argument, (`ld hl, [sp]`) and `sp` is *increased* by two bytes. Similarly, the `call Subroutine` instruction effectively pushes the address of the next instruction to execute (after `call Subroutine`) onto the stack, and jumps to `Subroutine`; `ret` likewise pops an address off the stack and jumps to it. 

Tragically, talking about the "top" and "bottom" of the stack, which is normally quite a sensible metaphor for a stack (you can only interact with the top of the stack, and change what the stack holds by putting things on or taking them off), is now hopelessly confusing due to the stack growing backwards, and thus confusion about whether we talk about the "top" as the end or the beginning of the region of memory, which has opposite sense from the end or beginning of the values placed on the stack, and before you know it you're going `@_@` and are totally lost. 

I'm going to adopt my own convention. When I talk about the stack, I'll try to refer to the "earliest" and "latest" values: the "earliest" value on the stack (as an organization of information) is the first value that was pushed there chronologically. The "latest" is the last value that was pushed there. If you pop data off the stack, you're getting the latest value, and the stack shortens; if you push data on the stack you're changing the latest and the stack grows. If you executed a `push $BEEF` and then `push $B0DE` and then `push $1337`, the stack would look like this, listed from earliest to latest:

| stack                                     |
| ----------------------------------------- |
| \[ whatever was on the stack previously ] |
| `$BEEF`                                   |
| `$B0DE`                                   |
| `$1337`                                   |
| \{ **stack ends here** }                  |

In this diagram I've written in \[ brackets ] to suggest some amount of data *previously* pushed onto the stack, and in \{ **curly braces** } a placeholder to indicate the end of the stack, the location `sp` points to, where new data will be pushed to. Most of the time, though, the stack is used as a call stack. When you execute a `call Subroutine` instruction, the address of the next line gets pushed onto the stack, and the processor jumps to `Subroutine`. When you execute a `ret` instruction, that address gets popped off the stack, and the processor jumps to it. So the stack stores a record of all the locations in memory it should return to!

So you have a stack pointer `sp` representing the end of a stack in memory. It holds data you put there, as well as the "call stack" featuring the locations successive `ret` instructions should return to. How does it interact with interrupts, though? Well, when an interrupt is handled, the processor effectively executes a `call InterruptHandler` instruction - it pushes the next address to execute onto the stack, and jumps to `InterruptHandler`. Then, when that code does a `ret`, it will restore computation from where we were before the interrupt.

Here's a theoretical interrupt we might write, and a marked line to pay attention to:

```
VBlankInterrupt:
	nop ; do nothing
	;;;;;; What's the stack look like here?
	ei ; enable interrupts
	ret
```

At the marked line, the stack has the following stuff on it, from earliest to latest:

| call stack                                                                                                                           |
| ------------------------------------------------------------------------------------------------------------------------------------ |
| \[ ... ]                                                                                                                             |
| \[ various stuff from before the interrupt fires ]                                                                                   |
| \[ more of that stuff ... ]                                                                                                          |
| the address that was being executed right before the interrupt fires, placed on the stack by the CPU when reacting to the interrupt. |
| \{ **stack ends here** }                                                                                                             |

Here I've written in \[ brackets ] some placeholder data, which could be `call` stack data, or could be data that was `push`ed onto the stack previously. But "the address that was being executed" got placed on the stack by the processor's interrupt handler.

When the `ret` is executed in the `VBlankInterrupt`, it pops the last value off the stack, and jumps execution to that address. But if, perchance, the last value on the stack was a different one than when this interrupt started, it would jump to a totally new spot...

Bear with me now: suppose you have two stacks. The "main thread stack" is currently in use, and, elsewhere in memory, there is an "async thread stack" which holds an address the async thread is executing. They look like this before the interrupt fires, from earliest to latest:

| main thread stack        | async thread stack           |
| ------------------------ | ---------------------------- |
| \[ various data ... ]    | \[ various data ... ]        |
| \{ **stack ends here** } | async thread program counter |

When the interrupt fires, it pushes the main thread's program counter onto the stack:

| main thread stack           | async thread stack           |
| --------------------------- | ---------------------------- |
| \[ various data ... ]       | \[ various data ... ]        |
| main thread program counter | async thread program counter |
| \{ **stack ends here** }    |                              |

What if the interrupt now swapped our stack pointer from the main stack to the async stack?

| main thread stack           | async thread stack           |
| --------------------------- | ---------------------------- |
| \[ various data ... ]       | \[ various data ... ]        |
| main thread program counter | async thread program counter |
|                             | \{ **stack ends here** }     |

Then at the end, it would `ret` and resume execution in the async thread.

| main thread stack           | async thread stack       |
| --------------------------- | ------------------------ |
| \[ various data ... ]       | \[ various data ... ]    |
| main thread program counter | \{ **stack ends here** } |

That's very simple! All you need in your handler to achieve this is the following:
```
VBlankInterrupt:
	; save main thread stack pointer
	ld [vMainSP], sp 
	
	; load side thread stack pointer
	ld sp, [vAsyncSP]
	
	ei
	ret
```
and then a matching STAT interrupt handler:
```
STATInterrupt:
	; load side thread stack pointer
	ld sp, [vAsyncSP]
	
	; save main thread stack pointer
	ld [vMainSP], sp 
	
	ei
	ret
```

This switches the stack context beautifully and avoids having to do any difficult manipulation of the program counter `pc` - it's all handled by the call stacks! 

But now you aren't holding onto the registers. In the last attempt, you had to write `ld [vAsyncAF], af` and the like, and I mentioned that those instructions don't actually exist and brushed over them. You can do it but it's slow and ugly. But! It turns out the stack can help you here as well! Just push all the registers onto the stack before switching, and then pop them off after. ggez!

Here's the new approach: the interrupt handler to switch contexts should do the following sequence:

1. push all the registers onto the stack 
2. save the stack pointer for the old context
3. fetch the stack pointer for the new context 
4. and then pop all the registers off the stack.

So here's what our "enter async thread" interrupt handler looks like now:
```
VBlankInterrupt: 
	push af
	push bc
	push de
	push hl 
	
	; save main thread stack pointer
	ld [vMainSP], sp 
	
	; load async thread stack pointer
	ld sp, [vAsyncSP]
	
	pop hl 
	pop de 
	pop bc
	pop af 
	
	ei
	ret
```

And then a matching interrupt handler to fire on the STAT interrupt when we hit scanline zero:

```
STATInterrupt: 
	push af
	push bc
	push de
	push hl 
	
	; save async thread stack pointer
	ld [vAsyncSP], sp 
	
	; load main thread stack pointer
	ld sp, [vMainSP]
	
	pop hl 
	pop de 
	pop bc
	pop af 
	
	ei
	ret
```

Pleasingly symmetric, no? This is quite close to the code I wrote in my project. There are two steps left: First, clean up one loose end, then, write a `RunInVBlank` subroutine to work with this stack-centric approach. Time for you to trim that loose end:

What happens when the subroutine in our thread returns the final time? At that point the stack pointer will be pointing past the stack, and you'll underflow the stack, but this is dang ol' game boy assembly, so there's no error handling but what you write yourself. The solution to this is very simple: We write a handler for when the subroutine returns, and put that on the stack first! When the subroutine returns, it'll execute the "early return" handler, and that can clean up and turn off the interrupts itself.

This "early return" handler is pretty simple: it just needs to turn off the interrupts, and maybe have some places to put other bookkeeping we might add in the future.

```
EarlyReturn:
	di ; disable interrupts globally, because this would result in very strange 
	   ; behavior otherwise if an interrupt somehow fired during it
	
	; turn off the specific interrupts we've been using
	ld hl, rIE            ; target the hardware register controlling interrupts
	res B_IE_VBLANK, [hl] ; reset the bit to turn off the v-blank interrupt
	res B_IE_STAT, [hl]   ; reset the bit to turn off the STAT interrupt
	
	; [do any other bookkeeping necessary here]
	
	ld sp, [vMainSP] ; restore the main thread's stack
	
	; get all the registers off the stack, because there's no longer
	; going to be a STAT interrupt to restore them
	pop hl
	pop de
	pop bc
	pop af
	
	ei ; re-enable interrupts globally at the end
	
	ret ; return execution to the main thread context
```

Now, to incorporate it. You'll put this on your stack first when you're preparing your `RunInVBlank` function. Then the subroutine you want to run goes on the stack next, and then the registers. Define a couple constants for the memory locations these live at. Let's write the final `RunInVBlank` function, fully using the stack and early return!

```
def ASYNC_STACK_TOP = $FFBF ; the top of the stack will be at this address
def ASYNC_STACK_EARLY_RETURN = ASYNC_STACK_TOP - 2 ; allocate two bytes to hold the early return handle
def ASYNC_STACK_FUNCTION = ASYNC_STACK_EARLY_RETURN - 2 ; two more bytes for where the async thread should resume from when it's called for the first time

RunInVBlank: 
	ld [vMainSP], sp ; store the stack pointer so we can restore after using it 
	
	; make sure we've got the early return handle at the base of the stack
	ld [ASYNC_STACK_EARLY_RETURN], EarlyReturn
	
	; now we want to build our stack. the first thing on it will be the function
	; we're running in the thread, so it can resume. so point the stack pointer 
	; at it
	ld sp, ASYNC_STACK_FUNCTION 
	
	push hl ; the argument to RunInVBlank is a subroutine address in hl.
	        ; so it goes on the stack first, at the location we just set sp to
	
	push af ; then we put all the registers in the right order 
	push bc ; so that when the program switches context into the async thread,
	push de ; it can get them out
	push hl
	
	; and now our async stack is set up! we just need to store it and 
	; restore the main thread stack
	
	ld [vAsyncSP], sp
	ld sp, [vMainSP]
	
	; enable the interrupts
	ld hl, rIE            ; target the interrupt enable flag
	set B_IE_VBLANK, [hl] ; set the bit to enable the v-blank interrupt
	set B_IE_STAT, [hl]   ; set the bit to enable the STAT interrupt
	ei                    ; enable interrupts globally
	
	ret	
```

And that's more or less the same as the code I wrote! At any time, you can pass a subroutine address via `hl`  to the `RunInVBlank` function, and it will then be executed in the background, only running between the v-blank and STAT interrupts. When it finishes by executing a `ret` instruction, it'll clean itself up, turn the interrupts off, and restore flow to the main thread. I think it's a pretty clean interface, and very usable. I've used it extensively in my year-long game boy project, the Liquid Crystal Dreams tarot deck. (Look for it soon on kickstarter!) I use this async function whenever I want to load graphics data, so I don't ever have to worry about when there's time to do it safely. It's all scheduled by interrupts and a couple of assembly-time constants!

Thanks for coming on this little journey with me. It was really fun to invent the wheel like this, especially because OS-level code is such a black box to me most of the time, but here I am, writing the assembly for a context switching thread management system. 

There's a handful of additional tasks which you might find interesting to think through, if you've been following along and want some more:

- You don't actually have some of the instructions I used, like loading a constant into `sp`. Can you write performant replacements for them?
- It's probably possible to combine the two interrupts into one.
- Use the stat interrupt for both the "switch from main context to async context" and "switch from async context to main context" cases. This requires the handler code to reconfigure what handler code is being used! Self-modifying as heck!
- What if the interrupts are needed for other functionality? Could you swap out interrupt handlers based on the state of the processor? How does this work with more interrupts?
- Can you use the same technique to write code that executes during the h-blank period? Why not?
- How would you pass information between the two threads? How would you store information about the state of the threaded code? How would you work with that information to make sure that all the code that needs to get executed does get executed?
- What happens when the async code returns?
- What do you do if you want to cancel the async thread?

And finally, some disclaimers and warnings:

Variable names have been changed to protect the innocent. There's some layers of indirection I've skipped, such as the interrupt vector jumping into a specified RAM address edited for configurable interrupts. This could have been avoided if I had known about the `jp hl` instruction, but it's probably faster. Concurrent access to RAM is the same headache as in modern code, which has caused some truly perplexing bugs - there's a very small chance that a context switch will happen between writing the first byte of an important memory address and the second byte, which can wreak havoc. I found it was usually sufficient to temporarily disable interrupts to make operations atomic - surround a memory access with `di` and `ei` to turn interrupts on and off, and they'll get handled afterwards if they happened in between. I am not an expert. In fact I know shockingly little about the conventional wisdom. This does not constitute legal or medical advice.

*I can be reached as "shoofle" wherever the internet is sold - most frequently these days i'm on [the fediverse as @shoofle@beach.city](https://beach.city/@shoofle), or on [bluesky as shoofle.bsky.social](https://bsky.app/profile/shoofle.bsky.social), or on [tumblr as ada-adorable](https://ada-adorable.tumblr.com). Gimme a holler if you read this!*
