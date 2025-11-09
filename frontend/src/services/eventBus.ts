import mitt from "mitt";

const eventBus = mitt<Record<string | symbol, unknown>>();

export default eventBus;