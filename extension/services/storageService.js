// services/storageService.js

const STORAGE = chrome.storage.local;

// ===============================
// Generic Storage
// ===============================

export async function save(key, value) {

    await STORAGE.set({
        [key]: value
    });

}

export async function load(key) {

    const result = await STORAGE.get(key);

    return result[key];

}

export async function remove(key) {

    await STORAGE.remove(key);

}

export async function clearStorage() {

    await STORAGE.clear();

}

// ===============================
// Memory
// ===============================

export async function saveMemory(memory) {

    const memories = await getMemories();

    memories.push({

        id: crypto.randomUUID(),

        timestamp: Date.now(),

        ...memory

    });

    await save("axis_memories", memories);

}

export async function getMemories() {

    return (await load("axis_memories")) || [];

}

export async function clearMemories() {

    await remove("axis_memories");

}

// ===============================
// Conversation
// ===============================

export async function saveConversation(message) {

    const history = await getConversation();

    history.push({

        id: crypto.randomUUID(),

        timestamp: Date.now(),

        ...message

    });

    await save("axis_conversation", history);

}

export async function getConversation() {

    return (await load("axis_conversation")) || [];

}

export async function clearConversation() {

    await remove("axis_conversation");

}

// ===============================
// User Preferences
// ===============================

export async function savePreference(key, value) {

    const prefs = (await load("axis_preferences")) || {};

    prefs[key] = value;

    await save("axis_preferences", prefs);

}

export async function getPreference(key) {

    const prefs = (await load("axis_preferences")) || {};

    return prefs[key];

}

// ===============================
// Reminders
// ===============================

export async function saveReminder(reminder) {

    const reminders = (await load("axis_reminders")) || [];

    reminders.push({

        id: crypto.randomUUID(),

        createdAt: Date.now(),

        ...reminder

    });

    await save("axis_reminders", reminders);

}

export async function getReminders() {

    return (await load("axis_reminders")) || [];

}

export async function deleteReminder(id) {

    const reminders = await getReminders();

    const updated = reminders.filter(r => r.id !== id);

    await save("axis_reminders", updated);

}

// ===============================
// Cached Context
// ===============================

export async function saveContext(context) {

    await save("axis_last_context", context);

}

export async function getLastContext() {

    return await load("axis_last_context");

}