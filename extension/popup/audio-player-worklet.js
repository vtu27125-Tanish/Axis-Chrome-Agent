// popup/audio-player-worklet.js

class AudioPlayerProcessor extends AudioWorkletProcessor {

    constructor() {

        super();

        this.queue = [];

        this.currentChunk = null;

        this.currentIndex = 0;

        this.isPaused = false;

        this.port.onmessage = (event) => {

            switch (event.data.type) {

                case "audio_data":

                    this.queue.push(
                        new Int16Array(event.data.buffer)
                    );

                    break;

                case "flush":

                    this.queue = [];

                    this.currentChunk = null;

                    this.currentIndex = 0;

                    break;

                case "pause":

                    this.isPaused = true;

                    break;

                case "resume":

                    this.isPaused = false;

                    break;

            }

        };

    }

    process(inputs, outputs) {

        const output = outputs[0][0];

        if (this.isPaused) {

            output.fill(0);

            return true;

        }

        for (let i = 0; i < output.length; i++) {

            if (
                !this.currentChunk ||
                this.currentIndex >= this.currentChunk.length
            ) {

                if (this.queue.length === 0) {

                    output[i] = 0;

                    continue;

                }

                this.currentChunk = this.queue.shift();

                this.currentIndex = 0;

            }

            output[i] =
                this.currentChunk[this.currentIndex++] / 32768;

        }

        return true;

    }

}

registerProcessor(
    "audio-player-processor",
    AudioPlayerProcessor
);