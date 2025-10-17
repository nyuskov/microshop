interface TodoItem {
    id: string;
    text: string;
    status: string;
}

interface Project {
    id: number;
    name: string;
}

interface ProjectsManifest {
    next_id: number;
    list: Project[];
}

const service = {
    getDefault() {
        return {
            id: Date.now().toString(16) + "_" + Math.ceil(Math.random() * 1000).toString(16),
            text: "",
            status: "not_started"
        }
    },
    getStatusList() {
        return [
            { id: "not_started", label: "Not started" },
            { id: "in_progress", label: "In progress" },
            { id: "completed", label: "Completed" }
        ]
    },
    validateTodo(item: TodoItem) {
        // The only requirement for a todo item is to have a name
        return item.text.length > 0;
    },
    makeCopy(item: TodoItem) {
        // Simple copy of a JSON object
        return JSON.parse(JSON.stringify(item))
    },
    toggleStatus(status: string) {
        // An extremely simple implementation of a state machine
        switch (status) {
            case "not_started":
                return "in_progress"
            case "in_progress":
                return "completed"
            case "completed":
                return "not_started"
        }
    },
    createTodoProject(name = "") {
        let projects = service.loadProjectsManifest()

        // Prepare the new project
        let project_id = projects.next_id

        // Update the projects manifest
        projects.next_id++;
        projects.list.push({ id: project_id, name });

        // Create project entry in local storage
        localStorage.setItem(`project.${project_id}`, "[]")

        // Save the projects manifest
        service.saveProjectsManifest(projects)
    },
    loadProjectsManifest(): ProjectsManifest {
        let projects = localStorage.getItem("projects");

        if (!projects) {
            projects = JSON.stringify({ next_id: 0, list: [] });
        }

        try {
            return JSON.parse(projects);
        } catch (e) {
            console.error("Failed to parse projects from localStorage", e);
            return { next_id: 0, list: [] };
        }
    },
    saveProjectsManifest(projects = {}) {
        // Save the manifest with a well known name
        localStorage.setItem("projects", JSON.stringify(projects))
    },
    deleteProject(project_id: number) {
        // Retrieve the manifes, and the index of the project in the list
        let manifest = service.loadProjectsManifest(),
            project_index = manifest.list.findIndex(p => {
                return p.id == project_id
            })

        // If the project is found...
        if (project_index > -1) {

            // Remove project from the manifest
            manifest.list.splice(project_index, 1)
            service.saveProjectsManifest(manifest)

            // Delete localStorage
            localStorage.removeItem(`project.${project_id}`)

        }
    },
    loadProject(project_id: number) {
        const data = localStorage.getItem(`project.${project_id}`);
        if (data === null) {
            return [];
        }
        try {
            return JSON.parse(data);
        } catch (e) {
            console.error(`Failed to parse project ${project_id}`, e);
            return [];
        }
    },
    saveProject(project_id: number, data: TodoItem) {
        // Store the item as string in localStorage
        localStorage.setItem(`project.${project_id}`, JSON.stringify(data))
    },
    getProjectName(project_id: number) {
        // Retrieve the project from the manifest and return the name
        let manifest = service.loadProjectsManifest(),
            project = manifest.list.find(p => {
                return p.id == project_id
            })
        if (project) {
            return project.name
        } else {
            return ""
        }
    }
}

export default service;