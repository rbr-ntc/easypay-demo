# Фотографии блюд — происхождение и лицензии

**Источник истины — `packages/config/photo-credits.json`.** Его читает интерфейс:
подпись «Фото: автор, лицензия» в карточке блюда и страница `#/credits`, на которую
ведёт ссылка внизу меню. CC BY требует называть автора в самом продукте, поэтому
данные живут в конфиге, а не только здесь. Тест `packages/config/tests/photos.test.js`
не даст добавить снимок без записи об авторе, флаг `photo` без файла или файл без флага.

Снимки подобраны через [Openverse](https://openverse.org) и Викисклад с фильтром
по лицензиям, разрешающим коммерческое использование и переработку (CC0, CC BY,
CC BY-SA). Кадрированы под 4:3, ужаты до 900×675, метаданные вычищены.

Шесть снимков, которые лежали в репозитории раньше (`duck`, `margarita`, `padthai`,
`springrolls`, `steak`, `tomyam`), были взяты с Викисклада без записи, какие именно
файлы, — восстановить авторов было нельзя. Они **заменены** снимками с известной лицензией.

Утка — под CC BY-SA 2.0: обрезанный кадр распространяется на тех же условиях.

Блюда без фотографии показываются компактной строкой без картинки — это предусмотрено
макетом, а не поломка: хумус, салат с тунцом, дорадо, котлета по-киевски, наполеон,
медовик, лазанья, вода, облепиховый чай.

Для публичного запуска этого мало: свободная съёмка разнородна по качеству. Нужна
либо собственная съёмка заведения, либо покупная (Shutterstock, Depositphotos).

| Блюдо | Автор | Лицензия | Источник |
|---|---|---|---|
| Белое полусухое | Paris Lodron Universität Salzburg (PLUS) | [CC BY 2.0](https://creativecommons.org/licenses/by/2.0/) | [flickr](https://www.flickr.com/photos/82751750@N02/14567866505) |
| Борщ с говядиной | неизвестен | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) | [rawpixel](https://www.rawpixel.com/image/5927756/photo-image-public-domain-food-free) |
| Брускетта с томатами | sarahstierch | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) | [flickr](https://www.flickr.com/photos/7633518@N08/54051484391) |
| Бургер с говядиной | Eaters Collective | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) | [stocksnap](https://stocksnap.io/photo/food-burger-WYL5KWIPUD) |
| Греческий | неизвестен | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) | [rawpixel](https://www.rawpixel.com/image/5968295/photo-image-public-domain-plant-red) |
| Домашний лимонад | Homedust | [CC BY 2.0](https://creativecommons.org/licenses/by/2.0/) | [flickr](https://www.flickr.com/photos/159630537@N08/42033707304) |
| Игристое брют | The Urban Botanist Images | [CC BY 2.0](https://creativecommons.org/licenses/by/2.0/) | [flickr](https://www.flickr.com/photos/193653073@N07/51442988494) |
| Капучино | joyosity | [CC BY 2.0](https://creativecommons.org/licenses/by/2.0/) | [flickr](https://www.flickr.com/photos/33993074@N00/8078218357) |
| Карбонара | неизвестен | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) | [rawpixel](https://www.rawpixel.com/image/6033676/photo-image-public-domain-food-free) |
| Картофель фри | sarahstierch | [CC BY 2.0](https://creativecommons.org/licenses/by/2.0/) | [flickr](https://www.flickr.com/photos/7633518@N08/52327287679) |
| Картофельное пюре | sarahstierch | [CC BY 2.0](https://creativecommons.org/licenses/by/2.0/) | [flickr](https://www.flickr.com/photos/7633518@N08/51960420703) |
| Красное сухое | неизвестен | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) | [rawpixel](https://www.rawpixel.com/image/5922530/photo-image-background-christmas-public-domain) |
| Крафтовый лагер | неизвестен | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) | [rawpixel](https://www.rawpixel.com/image/5925051/photo-image-background-christmas-public-domain) |
| Креветки в темпуре | неизвестен | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) | [rawpixel](https://www.rawpixel.com/image/5901281/photo-image-public-domain-nature-food) |
| Крем-суп из тыквы | неизвестен | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) | [rawpixel](https://www.rawpixel.com/image/5922901/photo-image-public-domain-leaf-fruit) |
| Мороженое | David Jackmanson | [CC BY 2.0](https://creativecommons.org/licenses/by/2.0/) | [flickr](https://www.flickr.com/photos/58301516@N00/52593139486) |
| Морс клюквенный | неизвестен | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) | [rawpixel](https://www.rawpixel.com/image/3299387/free-photo-image-ice-juice-cream-soda) |
| Негрони | Bex.Walton | [CC BY 2.0](https://creativecommons.org/licenses/by/2.0/) | [flickr](https://www.flickr.com/photos/7831824@N04/52399830723) |
| Овощи гриль | jijokini | [CC BY 2.0](https://creativecommons.org/licenses/by/2.0/) | [flickr](https://www.flickr.com/photos/194978137@N04/51913552725) |
| Пад тай | loustejskal.com | [CC BY 2.0](https://creativecommons.org/licenses/by/2.0/) | [flickr](https://www.flickr.com/photos/63311602@N08/52403902319) |
| Пицца «Маргарита» | midnightbreakfastcafe | [CC BY 2.0](https://creativecommons.org/licenses/by/2.0/) | [flickr](https://www.flickr.com/photos/193353181@N06/51969167207) |
| Пицца «Пепперони» | bshamblen | [CC BY 2.0](https://creativecommons.org/licenses/by/2.0/) | [flickr](https://www.flickr.com/photos/23972840@N04/27566605040) |
| Ризотто с белыми грибами | kurmanstaff | [CC BY 2.0](https://creativecommons.org/licenses/by/2.0/) | [flickr](https://www.flickr.com/photos/62558987@N07/51294061602) |
| Свёкла с козьим сыром | sarahstierch | [CC BY 2.0](https://creativecommons.org/licenses/by/2.0/) | [flickr](https://www.flickr.com/photos/7633518@N08/51696059054) |
| Спринг-роллы | chooyutshing | [CC BY 2.0](https://creativecommons.org/licenses/by/2.0/) | [flickr](https://www.flickr.com/photos/25802865@N08/54538849838) |
| Стейк рибай | Missvain | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0) | [wikimedia](https://commons.wikimedia.org/wiki/File:Rock_Sea%27s_steak_frites_-_February_2023_-_Sarah_Stierch_08.jpg) |
| Тар-тар из говядины | ResonantFelicity | [CC BY 2.0](https://creativecommons.org/licenses/by/2.0/) | [flickr](https://www.flickr.com/photos/9445979@N03/47328179461) |
| Том ям | неизвестен | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) | [rawpixel](https://www.rawpixel.com/image/5905843/photo-image-background-public-domain-food) |
| Утка по-пекински | Mr Wabu | [CC BY-SA 2.0](https://creativecommons.org/licenses/by-sa/2.0) | [wikimedia](https://commons.wikimedia.org/wiki/File:Peking_duck_by_Mr_Wabu_in_Beijing.jpg) |
| Уха из трёх рыб | comedy_nose | [CC BY 2.0](https://creativecommons.org/licenses/by/2.0/) | [flickr](https://www.flickr.com/photos/23408922@N07/52690978908) |
| Цезарь с курицей | Thank You (23 Millions+) views | [CC BY 2.0](https://creativecommons.org/licenses/by/2.0/) | [flickr](https://www.flickr.com/photos/34128007@N04/51141932019) |
| Чизкейк Нью-Йорк | неизвестен | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) | [rawpixel](https://www.rawpixel.com/image/5924639/photo-image-public-domain-illustration-fruit) |
| Эспрессо | неизвестен | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) | [rawpixel](https://www.rawpixel.com/image/5927734/photo-image-public-domain-wooden-coffee) |
