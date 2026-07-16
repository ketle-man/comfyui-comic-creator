import { app } from "../../scripts/app.js";

app.registerExtension({
    name: "ComicCreater.TopBar",
    actionBarButtons: [
        {
            icon: "pi pi-palette",
            label: "CC",
            tooltip: "Comic Creater を開く",
            onClick: () => window.open("/ccc", "_blank"),
        },
    ],
});
