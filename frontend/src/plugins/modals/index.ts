import { reactive, type App } from "vue";
import Modal from "./Modal.vue";

const _current = reactive<{
    name: string;
    resolve: null | (() => void);
    reject: null | (() => void);
}>({ name: "", resolve: null, reject: null });

const api = {
    active() { return _current.name; },
    show(name: string) {
        _current.name = name;
        return new Promise<void>(
            (resolve = () => { }, reject = () => { }) => {
                _current.resolve = resolve;
                _current.reject = reject;
            });
    },
    accept() {
        if (_current.resolve) {
            _current.resolve();
        }
        _current.name = "";
    },
    cancel() {
        if (_current.reject) {
            _current.reject();
        }
        _current.name = "";
    },
}
const plugin = {
    install(app: App) {
        app.component("Modal", Modal);
        app.provide("$modals", api);
    }
}
export default plugin;