import { app } from "../../scripts/app.js";

app.registerExtension({
    name: "ComicCreator.TopBar",
    actionBarButtons: [
        {
            icon: "pi pi-palette",
            label: "CC",
            tooltip: "Comic Creator を開く",
            onClick: () => window.open("/ccc", "_blank"),
        },
    ],
});
