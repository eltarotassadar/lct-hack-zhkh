### Prerequisites

- Проект работает на версиях Python 3.12 и 3.11
- Должен быть установлен [poetry](https://python-poetry.org/docs/#installing-with-the-official-installer).
- (Optional) В папке backend использовать `poetry env use <указать путь до файла python нужной версии>`.

### Usage
1. `poetry install`
- (Optional - если `fastapi` не будет найден терминалом) `poetry shell`
2. `fastapi dev main.py`
3. check `http://127.0.0.1:8000/api/health` or `http://127.0.0.1:8000/docs`