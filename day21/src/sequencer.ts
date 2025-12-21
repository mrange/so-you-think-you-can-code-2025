/**
 * A timeline-based sequencer for managing musical scenes and progress tracking.
 * Handles conversion between different time units and maintains current playback state.
 */
export class Sequencer {
    /** The ID of the currently active scene */
    public currentSceneId: number = 0;
    /** Flags associated with the current scene */
    public currentFlags: number = 0;
    /** Progress within the current scene (0.0 to 1.0) */
    public progress: number = 0; // 0.0 to 1.0 within the scene
    
    /**
     * Creates a new Sequencer instance.
     * @param timeline - Array of scene data where each scene is [duration, flags, sceneId]
     * @param bpm - Beats per minute for musical timing calculations
     * @param beatsPerBar - Number of beats in each bar for musical timing
     */
    constructor(
        private timeline: any[][], 
        public bpm: number = 120,
        public beatsPerBar: number = 4
    ) {}

    /**
    * Converts milliseconds into Relative Units for timeline positioning.
    * Best for intros, breakdowns, FX tails, silence.
    * @param ms - Duration in milliseconds
    * @param totalLength - Total length of the timeline in some reference unit
    * @returns The duration in relative units
    */
    getUnitsFromMs(ms: number, totalLength: number): number {
        return (ms * 44.1) / (totalLength * 2);
    }

    /**
    * Converts musical bars into Relative Units for timeline positioning.
    * Best for grooves, drops, verses, repeating structures.
    * @param bars - Duration in musical bars
    * @param totalLength - Total length of the timeline in some reference unit
    * @returns The duration in relative units
    */
    getUnitsFromBars(bars: number, totalLength: number): number {
        const secondsPerBeat = 60 / this.bpm;
        const secondsPerBar  = secondsPerBeat * this.beatsPerBar;
        return this.getUnitsFromMs(bars * secondsPerBar * 1000, totalLength);
    }

    /**
     * Updates the sequencer state based on the current playback time.
     * Determines which scene is currently active and calculates progress within that scene.
     * @param seconds - Current playback time in seconds
     * @param L - Total length parameter used in unit conversion calculations
     */
    update(seconds: number, L: number): void {
        let playhead = (seconds * 1000 * 44.1) / (L * 2);
        
        let cursor = 0;
        let localTime = playhead;

        while (
            cursor < this.timeline.length - 1 && 
            this.timeline[cursor][0] < 255 && 
            localTime >= this.timeline[cursor][0]
        ) {
            localTime -= this.timeline[cursor++][0];
        }

        const activeScene = this.timeline[cursor];
        this.currentFlags = activeScene[1];
        this.currentSceneId = activeScene[2];
        
        this.progress = Math.min(Math.max(0, localTime / activeScene[0]), 1);
    }
}