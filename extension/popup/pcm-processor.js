// popup/pcm-processor.js

class PCMProcessor extends AudioWorkletProcessor {

    constructor() {

        super();

        // ===========================
        // Voice Activity Detection
        // ===========================

        this.energyThreshold = 0.0015;

        this.speechDuration = 0.20;

        this.silenceDuration = 0.60;

        this.speechFrames = 0;

        this.silenceFrames = 0;

        this.isSpeaking = false;

        this.sampleRate = sampleRate;

        // ===========================
        // Audio Buffer
        // ===========================

        this.bufferSize = 1600;

        this.audioBuffer = new Int16Array(this.bufferSize);

        this.offset = 0;

    }

    calculateEnergy(samples) {

        let sum = 0;

        for (let i = 0; i < samples.length; i++) {

            sum += samples[i] * samples[i];

        }

        return Math.sqrt(sum / samples.length);

    }

    process(inputs) {

        const input = inputs[0]?.[0];

        if (!input) return true;

        // ===========================
        // Voice Activity Detection
        // ===========================

        const energy = this.calculateEnergy(input);

        const duration = input.length / this.sampleRate;

        if (energy > this.energyThreshold) {

            this.speechFrames += duration;

            this.silenceFrames = 0;

            if (!this.isSpeaking &&
                this.speechFrames >= this.speechDuration) {

                this.isSpeaking = true;

                this.port.postMessage({

                    type: "speech_start"

                });

            }

        } else {

            this.silenceFrames += duration;

            if (this.isSpeaking &&
                this.silenceFrames >= this.silenceDuration) {

                this.isSpeaking = false;

                this.speechFrames = 0;

                this.port.postMessage({

                    type: "speech_end"

                });

            }

        }

        // ===========================
        // PCM Conversion
        // ===========================

        for (let i = 0; i < input.length; i++) {

            const s = Math.max(-1, Math.min(1, input[i]));

            this.audioBuffer[this.offset++] =
                s < 0
                    ? s * 0x8000
                    : s * 0x7fff;

            if (this.offset >= this.bufferSize) {

                const chunk =
                    this.audioBuffer.slice(0, this.offset).buffer;

                this.port.postMessage({

                    type: "audio_data",

                    buffer: chunk

                }, [chunk]);

                this.offset = 0;

            }

        }

        return true;

    }

}

registerProcessor(
    "pcm-processor",
    PCMProcessor
);