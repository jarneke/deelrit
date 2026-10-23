import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
    return {
        id: "/",
        name: "Deelrit",
        short_name: "Deelrit",
        description: "Jullie gedeelde auto, kilometers en kosten op één plek.",
        lang: "nl",
        start_url: "/",
        scope: "/",
        display: "standalone",
        background_color: "#ffffff",
        theme_color: "#4164e8",
        icons: [
            {
                src: "/apple-icon.png",
                type: "image/png",
            },
        ],
    };
}