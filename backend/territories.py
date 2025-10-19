"""Shared territory presets for geo analytics."""

from __future__ import annotations

TERRITORY_PRESETS: dict[str, dict[str, list[str]]] = {
    "centralDistrict": {
        "label": "Центральный округ снабжения",
        "cells": [
            "8611aa7afffffff",
            "8611aa7a7ffffff",
            "8611aa787ffffff",
            "8611aa78fffffff",
            "8611aa637ffffff",
            "8611aa71fffffff",
        ],
    },
    "southDistrict": {
        "label": "Южный водорайон",
        "cells": [
            "8611aa797ffffff",
            "8611aa4cfffffff",
            "861181b67ffffff",
            "861181b6fffffff",
            "8611aa79fffffff",
            "8611aa7b7ffffff",
        ],
    },
    "riversideCluster": {
        "label": "Речной инфраструктурный кластер",
        "cells": [
            "8611aa45fffffff",
            "8611aa717ffffff",
            "8611aa44fffffff",
            "8611aa447ffffff",
            "8611aa457ffffff",
            "8611aa4efffffff",
        ],
    },
    "northernReservoir": {
        "label": "Северный кластер резервуаров",
        "cells": [
            "8611aa72fffffff",
            "8611aa727ffffff",
            "8611aa707ffffff",
            "8611aa70fffffff",
            "8611aa777ffffff",
            "8611aa0dfffffff",
        ],
    },
    "eastTechBelt": {
        "label": "Восточный технопояс",
        "cells": [
            "8611aa6afffffff",
            "8611aa6a7ffffff",
            "8611aa687ffffff",
            "8611aa68fffffff",
            "8611aa6f7ffffff",
            "8611aa61fffffff",
        ],
    },
    "northWestHub": {
        "label": "Северо-западный промышленный узел",
        "cells": [
            "8611aa737ffffff",
            "8611aa46fffffff",
            "8611aa09fffffff",
            "8611aa097ffffff",
            "8611aa467ffffff",
            "8611aa0d7ffffff",
        ],
    },
    "southWestArc": {
        "label": "Юго-западный логистический пояс",
        "cells": [
            "8611aa4e7ffffff",
            "8611aa4c7ffffff",
            "8611aa4dfffffff",
            "8611aa477ffffff",
            "8611aa40fffffff",
            "8611aa41fffffff",
        ],
    },
    "southEastEnergy": {
        "label": "Юго-восточный энергетический контур",
        "cells": [
            "8611aa6b7ffffff",
            "861181b4fffffff",
            "8611aa697ffffff",
            "861181b47ffffff",
            "861181b5fffffff",
            "861181a67ffffff",
        ],
    },
}

DISTRICT_LOOKUP: dict[str, dict[str, str]] = {}
for key, preset in TERRITORY_PRESETS.items():
    for cell_id in preset["cells"]:
        DISTRICT_LOOKUP[cell_id] = {"key": key, "label": preset["label"]}
