// content/pcm-processor.js (AudioWorklet)
// PCM extraction processor for mic recording in content script context.
// Buffers ~100ms of audio (1600 samples at 16kHz) before sending to reduce
// message overhead and improve audio quality for the model.

class PCMProcessor extends AudioWorkletProcessor {

    constructor() {

        super();

        this._buffer = new Int16Array(1600);

        this._offset = 0;

    }

    process(inputs) {

        const input = inputs[0]?.[0];

        if (!input) return true;

        for (let i = 0; i < input.length; i++) {

            const s = Math.max(-1, Math.min(1, input[i]));

            this._buffer[this._offset++] =
                s < 0
                    ? s * 0x8000
                    : s * 0x7fff;

            if (this._offset >= this._buffer.length) {

                const chunk =
                    this._buffer.slice(0, this._offset).buffer;

                this.port.postMessage(
                    {
                        type: "audio_data",
                        buffer: chunk
                    },
                    [chunk]
                );

                this._offset = 0;

            }

        }

        return true;

    }

}

registerProcessor(
    "pcm-processor",
    PCMProcessor
);