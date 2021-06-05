"use strict";

const fs           = require("fs");
const xmlBuilder   = require("xmlbuilder");
const xml2Js       = require("xml2js");
const childProcess = require("child_process");

const fBuildDir = "build";
const fGlyphSvg = fBuildDir + "/glyph.svg";
const fGlyphTtf = fBuildDir + "/glyph.ttf";
const fGlyphTtx = fBuildDir + "/glyph.ttx";
const fOutTtx   = fBuildDir + "/out.ttx";

const fontforgeCode = "\
import fontforge\n\
\
font = fontforge.font()\n\
font.ascent = 512\n\
font.descent = 0\n\
\
glyph = font.createChar(0)\n\
glyph.importOutlines('" + fGlyphSvg + "')\n\
glyph.correctDirection()\n\
glyph.transform(psMat.translate(0.0, -92.0))\n\
\
font.generate('" + fGlyphTtf + "')\n\
";

const parserSvg = new xml2Js.Parser({
    preserveChildrenOrder: true,
    explicitChildren:      true,
    explicitArray:         true
});

const parserTtx = new xml2Js.Parser({
    preserveChildrenOrder: true
});

const dateFormat = function(date) {
    const pad = function(n, padStr) {
        const s = n.toString();
        if(n < 10) {
            return padStr + s;
        } else {
            return s;
        }
    };
    let value;
    switch(date.getDay()) {
    case 0: value = "Sun"; break;
    case 1: value = "Mon"; break;
    case 2: value = "Tue"; break;
    case 3: value = "Wed"; break;
    case 4: value = "Thu"; break;
    case 5: value = "Fri"; break;
    case 6: value = "Sat"; break;
    }
    switch(date.getMonth()) {
    case  0: value += " Jan"; break;
    case  1: value += " Feb"; break;
    case  2: value += " Mar"; break;
    case  3: value += " Apr"; break;
    case  4: value += " May"; break;
    case  5: value += " Jun"; break;
    case  6: value += " Jul"; break;
    case  7: value += " Aug"; break;
    case  8: value += " Sep"; break;
    case  9: value += " Oct"; break;
    case 10: value += " Nov"; break;
    case 11: value += " Dec"; break;
    }
    value +=
        " " + pad(date.getDate(),    " ") +
        " " + pad(date.getHours(),   "0") +
        ":" + pad(date.getMinutes(), "0") +
        ":" + pad(date.getSeconds(), "0") +
        " " + date.getFullYear();
    return value;
};

const unwrapProc = function(proc) {
    if(proc.error) {
        throw proc.error;
    } else if(proc.status != 0) {
        throw new Error("Process exited with code " + proc.status.toString() + ": " + proc.stderr);
    }
};

const addToXml = function(xml, p) {
    if(p["#name"] == "g") {
        const g = xml.ele("g", p["$"]);
        if(p["$$"]) {
            p["$$"].forEach((pn) => addToXml(g, pn));
        }
    } else {
        xml.ele(p["#name"], p["$"]);
    }
};

const expandColor = function(c) {
    if(c == undefined) {
        return c;
    }
    c = c.toLowerCase();
    if(c == "none") {
        return c;
    } else if(c.substr(0, 1) == "#") {
        if(c.length == 4) {
            c = "#" +
                c.substr(1, 1) + c.substr(1, 1) +
                c.substr(2, 1) + c.substr(2, 1) +
                c.substr(3, 1) + c.substr(3, 1);
        }
        return c + "ff";
    } else if(c.substr(0, 4) == "rgb(") {
        const rgb = c.substr(4, c.length - 1).split(",");
        return "#" + rgb.map(function(ch) {
            ch = parseFloat(ch.substr(0, ch.length - 1));
            ch = Math.round(ch * 2.55);
            ch = Math.min(ch, 255);
            ch = ch.toString(16);
            switch(ch.length) {
            case 0: return '00';
            case 1: return '0' + ch;
            case 2: return ch;
            }
        }).join('');
    } else {
        throw 'invalid color ' + c;
    }
};

const applyOpacity = function(c, o) {
    if(c == undefined || c == 'none') {
        return c;
    }
    let opacity = o * parseInt(c.substr(7), 16) / 255;
    opacity = Math.round(opacity * 255);
    opacity = opacity.toString(16);
    if(opacity.length == 1) {
        opacity = '0' + opacity;
    }
    return c.substr(0, 7) + opacity;
};

const hexByte = function(b) {
    const s = b.toString(16);
    if(s.length < 2) {
        return "0" + s;
    } else if(s.length > 2) {
        // shouldn't happen
        return s.substr(s.length - 2, 2);
    } else {
        return s;
    }
};

const decodePath = function(d) {
    const c = '\\s*(-?(?:[0-9]*\\.[0-9]+|[0-9]+)),?';
    let x = 0;
    let y = 0;
    const result = [];
    let segStart = [0, 0];
    while (d != "") {
        let matches = d.match("^\s*([MmLlHhVvCcZzSsTtQqAa])");
        if(!matches) {
            break;
        }
        d = d.substr(matches[0].length);
        let op = matches[1];
        let coords;
        switch(op) {
        case 'M':
            segStart = undefined;
            while (coords = d.match('^' + c + c)) {
                d = d.substr(coords[0].length);
                x = Number(coords[1]);
                y = Number(coords[2]);
                if(segStart == undefined) {
                    segStart = [x, y];
                }
                result.push([x, y]);
            }
            break;
        case 'L':
            while (coords = d.match('^' + c + c)) {
                d = d.substr(coords[0].length);
                x = Number(coords[1]);
                y = Number(coords[2]);
                result.push([x, y]);
            }
            break;
        case 'm':
            segStart = undefined;
            while (coords = d.match('^' + c + c)) {
                d = d.substr(coords[0].length);
                x += Number(coords[1]);
                y += Number(coords[2]);
                if(segStart == undefined) {
                    segStart = [x, y];
                }
                result.push([x, y]);
            }
            break;
        case 'l':
            while (coords = d.match('^' + c + c)) {
                d = d.substr(coords[0].length);
                x += Number(coords[1]);
                y += Number(coords[2]);
                result.push([x, y]);
            }
            break;
        case 'H':
            while (coords = d.match('^' + c)) {
                d = d.substr(coords[0].length);
                x = Number(coords[1]);
                result.push([x, y]);
            }
            break;
        case 'h':
            while (coords = d.match('^' + c)) {
                d = d.substr(coords[0].length);
                x += Number(coords[1]);
                result.push([x, y]);
            }
            break;
        case 'V':
            while (coords = d.match('^' + c)) {
                d = d.substr(coords[0].length);
                y = Number(coords[1]);
                result.push([x, y]);
            }
            break;
        case 'v':
            while (coords = d.match('^' + c)) {
                d = d.substr(coords[0].length);
                y += Number(coords[1]);
                result.push([x, y]);
            }
            break;
        case 'C':
            while (coords = d.match('^' + c + c + c + c + c + c)) {
                d = d.substr(coords[0].length);
                x = Number(coords[1]);
                y = Number(coords[2]);
                result.push([x, y]);
                x = Number(coords[3]);
                y = Number(coords[4]);
                result.push([x, y]);
                x = Number(coords[5]);
                y = Number(coords[6]);
                result.push([x, y]);
            }
            break;
        case 'c':
            while (coords = d.match('^' + c + c + c + c + c + c)) {
                d = d.substr(coords[0].length);
                result.push([x + Number(coords[1]), y + Number(coords[2])]);
                result.push([x + Number(coords[3]), y + Number(coords[4])]);
                x += Number(coords[5]);
                y += Number(coords[6]);
                result.push([x, y]);
            }
            break;
        case 'S':
            while (coords = d.match('^' + c + c + c + c)) {
                d = d.substr(coords[0].length);
                x = Number(coords[1]);
                y = Number(coords[2]);
                result.push([x, y]);
                x = Number(coords[3]);
                y = Number(coords[4]);
                result.push([x, y]);
            }
            break;
        case 's':
            while (coords = d.match('^' + c + c + c + c)) {
                d = d.substr(coords[0].length);
                result.push([x + Number(coords[1]), y + Number(coords[2])]);
                x += Number(coords[3]);
                y += Number(coords[4]);
                result.push([x, y]);
            }
            break;
        case 'Q':
            while (coords = d.match('^' + c + c + c + c)) {
                d = d.substr(coords[0].length);
                result.push([x + Number(coords[1]), y + Number(coords[2])]);
                x = Number(coords[3]);
                y = Number(coords[4]);
                result.push([x, y]);
            }
            break;
        case 'q':
            while (coords = d.match('^' + c + c + c + c)) {
                d = d.substr(coords[0].length);
                result.push([x + Number(coords[1]), y + Number(coords[2])]);
                x += Number(coords[3]);
                y += Number(coords[4]);
                result.push([x, y]);
            }
            break;
        case 'T':
            while (coords = d.match('^' + c + c)) {
                d = d.substr(coords[0].length);
                x = Number(coords[1]);
                y = Number(coords[2]);
                result.push([x, y]);
            }
            break;
        case 't':
            while (coords = d.match('^' + c + c)) {
                d = d.substr(coords[0].length);
                x += Number(coords[1]);
                y += Number(coords[2]);
                result.push([x, y]);
            }
            break;
        case 'A':
            // we don't fully handle arc, just grab the endpoint
            while (coords = d.match('^' + c + c + c + c + c + c + c)) {
                d = d.substr(coords[0].length);
                x = Number(coords[6]);
                y = Number(coords[7]);
                result.push([x, y]);
            }
            break;
        case 'a':
            while (coords = d.match('^' + c + c + c + c + c + c + c)) {
                d = d.substr(coords[0].length);
                x += Number(coords[6]);
                y += Number(coords[7]);
                result.push([x, y]);
            }
            break;
        case 'Z':
        case 'z':
            x = segStart[0];
            y = segStart[1];
            result.push([x, y]);
            break;
        }
    }
    return result;
};

const getBBox = function(p) {
    if(p['#name'] == 'path') {
        const points = decodePath(p['$']['d']);
        const result = [0, 0, 0, 0];
        points.forEach(function(pt) {
            if(pt[0] < result[0]) { result[0] = pt[0]; }
            if(pt[1] < result[1]) { result[1] = pt[1]; }
            if(pt[0] > result[2]) { result[2] = pt[0]; }
            if(pt[1] > result[3]) { result[3] = pt[1]; }
        });
        return result;
    } else if(p['#name'] == 'circle') {
        const cx = Number(p['$']['cx']);
        const cy = Number(p['$']['cy']);
        const r = Number(p['$']['r']);
        return [cx - r, cy - r, cx + r, cy + r];
    } else if(p['#name'] == 'ellipse') {
        const cx = Number(p['$']['cx']);
        const cy = Number(p['$']['cy']);
        const rx = Number(p['$']['rx']);
        const ry = Number(p['$']['ry']);
        return [cx - rx, cy - ry, cx + rx, cy + ry];
    } else {
        return [0, 0, 0, 0];
    }
};

const overlap = function(a, b) {
    if(a[2] <= b[0] || b[2] <= a[0] || a[3] <= b[1] || b[3] <= a[1]) {
        return false;
    } else {
        return true;
    }
};

const hasTransform = function(p) {
    return p['$']['transform'] !== undefined;
};

const addOrMerge = function(paths, p, color) {
    let i = -1;
    if(!hasTransform(p)) {
        i = paths.length - 1;
        const bbox = getBBox(p);
        while (i >= 0) {
            let hasOverlap = false;
            paths[i].paths.forEach(function(pp) {
                if(hasTransform(pp) || overlap(bbox, getBBox(pp))) {
                    hasOverlap = true;
                }
            });
            if(hasOverlap) {
                i = -1;
                break;
            }
            if(paths[i].color == color) {
                break;
            }
            --i;
        }
    }
    if(i >= 0) {
        paths[i].paths.push(p);
    } else {
        paths.push({color: color, paths: [p]});
    }
};

const recordGradient = function(grp, urlColor) {
    const stops = [];
    const id = '#' + grp['$']['id'];
    grp['$$'].forEach(function(child) {
        if(child['#name'] == "stop") {
            stops.push(expandColor(child['$']['stop-color']));
        }
    });
    const stopCount = stops.length;
    let r = 0, g = 0, b = 0;
    if(stopCount > 0) {
        stops.forEach(function(stop) {
            r = r + parseInt(stop.substr(1, 2), 16);
            g = g + parseInt(stop.substr(3, 2), 16);
            b = b + parseInt(stop.substr(5, 2), 16);
        });
        r = Math.round(r / stopCount);
        g = Math.round(g / stopCount);
        b = Math.round(b / stopCount);
    }
    urlColor[id] = "#" + hexByte(r) + hexByte(g) + hexByte(b);
};

const processFile = function(fontData, fileName, data) {
    // strip .svg extension off the name
    const baseName = fileName.replace(".svg", "");

    parserSvg.parseString(data, function(err, result) {
        const paths = [];
        const defs = {};
        const urlColor = {};

        const addToPaths = function(
            defaultFill, defaultStroke, defaultOpacity,
            defaultStrokeWidth, xform, elems
        ) {
            elems.forEach(function(e) {
                if(e['#name'] == 'metadata') {
                    e = undefined;
                    return;
                }

                if(e['#name'] == 'defs') {
                    if(e['$$'] != undefined) {
                        e['$$'].forEach(function(def) {
                            if(def['#name'] == 'linearGradient') {
                                recordGradient(def, urlColor);
                            } else {
                                defs['#' + def['$']['id']] = def;
                            }
                        });
                    }
                    return;
                }

                if(e['#name'] == 'linearGradient') {
                    recordGradient(e, urlColor);
                    return;
                }

                if(e['$'] == undefined) {
                    e['$'] = {};
                }

                e['$']['style'] = undefined;
                e['$']['shape-rendering'] = undefined;

                let fill = e['$']['fill'];
                let stroke = e['$']['stroke'];
                let strokeWidth = e['$']['stroke-width'] || defaultStrokeWidth;

                // any path with an 'id' might get re-used, so
                // remember it
                if(e['$']['id']) {
                    defs['#' + e['$']['id']] = JSON.parse(JSON.stringify(e));
                }

                let t = e['$']['transform'];
                if(t) {
                    // fontforge import doesn't understand 3-argument
                    // 'rotate', so we decompose it into
                    // translate..rotate..untranslate
                    const c = '(-?(?:[0-9]*\\.[0-9]+|[0-9]+))';
                    while (true) {
                        const m = t.match(
                            'rotate\\(' + c + '\\s+' + c + '\\s' + c + '\\)'
                        );
                        if(!m) {
                            break;
                        }
                        const a = Number(m[1]);
                        const x = Number(m[2]);
                        const y = Number(m[3]);
                        const rep = 'translate(' + x + ' ' + y + ') ' +
                                    'rotate(' + a + ') ' +
                                    'translate(' + (-x) + ' ' + (-y) + ')';
                        t = t.replace(m[0], rep);
                    }
                    e['$']['transform'] = t;
                }

                if(fill && fill.substr(0, 3) == "url") {
                    const id = fill.substr(4, fill.length - 5);
                    if(urlColor[id] == undefined) {
                        console.log('### ' + baseName + ': no mapping for ' + fill);
                    } else {
                        fill = urlColor[id];
                    }
                }
                if(stroke && stroke.substr(0, 3) == "url") {
                    const id = stroke.substr(4, stroke.length - 5);
                    if(urlColor[id] == undefined) {
                        console.log('### ' + baseName + ': no mapping for ' + stroke);
                    } else {
                        stroke = urlColor[id];
                    }
                }

                fill = expandColor(fill);
                stroke = expandColor(stroke);

                fill = fill || defaultFill;
                stroke = stroke || defaultStroke;

                const opacity = (e['$']['opacity'] || 1.0) * defaultOpacity;

                if(e['#name'] == 'g') {
                    if(e['$$'] != undefined) {
                        addToPaths(
                            fill, stroke, opacity, strokeWidth,
                            e['$']['transform'] || xform, e['$$']
                        );
                    }
                } else if(e['#name'] == 'use') {
                    const target = defs[e['$']['xlink:href']];
                    if(target) {
                        addToPaths(
                            fill, stroke, opacity, strokeWidth,
                            e['$']['transform'] || xform,
                            [JSON.parse(JSON.stringify(target))]
                        );
                    }
                } else {
                    if(!e['$']['transform'] && xform) {
                        e['$']['transform'] = xform;
                    }
                    if(fill != 'none') {
                        const f = JSON.parse(JSON.stringify(e));
                        f['$']['stroke'] = 'none';
                        f['$']['stroke-width'] = '0';
                        f['$']['fill'] = '#000';
                        if(opacity != 1.0) {
                            fill = applyOpacity(fill, opacity);
                        }
                        // Insert a Closepath before any Move commands
                        // within the path data, as fontforge import
                        // doesn't handle unclosed paths reliably.
                        if(f['#name'] == 'path') {
                            const d = f['$']['d'].replace(/M/g, 'zM').replace(/m/g, 'zm').replace(/^z/, '').replace(/zz/gi, 'z');
                            if(f['$']['d'] != d) {
                                f['$']['d'] = d;
                            }
                        }
                        addOrMerge(paths, f, fill);
                    }

                    // fontforge seems to hang on really complex thin
                    // strokes so we arbitrarily discard them for now
                    if(stroke != 'none' &&
                       (e['#name'] != 'path' ||
                        Number(strokeWidth) > 0.25 ||
                        (e['$']['d'].length < 500 &&
                         Number(strokeWidth) > 0.1)))
                    {
                        const s = JSON.parse(JSON.stringify(e));
                        s['$']['fill'] = 'none';
                        s['$']['stroke'] = '#000';
                        s['$']['stroke-width'] = strokeWidth;
                        if(opacity) {
                            stroke = applyOpacity(stroke, opacity);
                        }
                        addOrMerge(paths, s, stroke);
                    }
                }
            });
        };

        addToPaths(
            '#000000ff', 'none', 1.0, '1', undefined, result['svg']['$$']
        );

        let layerIndex = 0;
        const layers = [];
        paths.forEach(function(path) {
            let svg = xmlBuilder.create("svg");
            for(const i in result['svg']['$']) {
                svg.att(i, result['svg']['$'][i]);
            }

            path.paths.forEach((pn) => addToXml(svg, pn));
            const svgString = svg.toString();

            // see if there's an already-defined component that
            // matches this shape
            let layerComponent = fontData.layerMapping[svgString];

            // if not, create a new component glyph for this layer
            if(layerComponent == undefined) {
                const newName = "u" + baseName + "layer" + layerIndex;
                fs.writeFileSync(fGlyphSvg, svgString);
                unwrapProc(childProcess.spawnSync(
                    "fontforge", ["-quiet", "-lang=py", "-c", fontforgeCode]
                ));
                unwrapProc(childProcess.spawnSync(
                    "ttx",
                    ["-i",
                     "-q",
                     "-t", "glyf",
                     "-t", "hmtx",
                     "-o", fGlyphTtx,
                     fGlyphTtf]
                ));
                const ttxData = fs.readFileSync(fGlyphTtx);
                let newData = undefined;
                let newLsb  = undefined;
                parserTtx.parseString(ttxData, function(err, result) {
                    for(const TTGlyph of result.ttFont.glyf[0].TTGlyph) {
                        if(TTGlyph['$'].name == "uni0000") {
                            TTGlyph['$'].name = newName;
                            newData = [TTGlyph];
                            break;
                        }
                    }
                    for(const mtx of result.ttFont.hmtx[0].mtx) {
                        if(mtx['$'].name == "uni0000") {
                            newLsb = mtx['$'].lsb;
                            break;
                        }
                    }
                });
                const unpack = function(data, head, out) {
                    data.forEach(function(obj) {
                        const next = out.ele(head);
                        for(const i in obj) {
                            if(i == '$') {
                                for(const j in obj[i]) {
                                    next.att(j, obj[i][j]);
                                }
                            } else {
                                unpack(obj[i], i, next);
                            }
                        }
                    });
                };
                const newFunc = (name, dat) => unpack(newData, name, dat);
                fontData.layerMapping[svgString] = layerComponent = fontData.layerDatum.length;
                fontData.layerDatum.push({name: newName, func: newFunc, lsb: newLsb});
            }

            // add to the glyph's list of color layers
            layers.push({
                color: path.color,
                name: fontData.layerDatum[layerComponent].name
            });

            // if we haven't seen this color before, add it to the palette
            if(fontData.colorToId[path.color] == undefined) {
                fontData.colorToId[path.color] = fontData.colors.length;
                fontData.colors.push(path.color);
            }
            layerIndex = layerIndex + 1;
        });

        fontData.chars.push({
            unicode: baseName,
            layers: layers,
            name: "u" + baseName
        });
    });
};

const main = function(fSourceDir) {
    const fontData = {
        info: JSON.parse(fs.readFileSync(fSourceDir + "/info.json").toString()),

        layerMapping: {},
        layerDatum: [],

        colors: [],
        colorToId: {},

        // list of all defined characters in the map (not including .notdef)
        chars: [{
            unicode: "0",
            layers: [],
            name: ".null"
        }],
    };

    fs.mkdirSync(fBuildDir, {recursive: true});

    // process the images from the main source folder
    fs.readdirSync(fSourceDir).forEach(function(path) {
        if(path.endsWith('.svg')) {
            const data = fs.readFileSync(fSourceDir + "/" + path);
            processFile(fontData, path, data);
        }
    });

    // start making the ttx file
    const ttFont = xmlBuilder.create("ttFont", {encoding: "UTF-8"})
          .att("sfntVersion", "\\x00\\x01\\x00\\x00")
          .att("ttLibVersion", "4.13");

    // text info
    fontData.info["3"] = fontData.info["1"] + " " + fontData.info.version;
    fontData.info["5"] = "Version " + fontData.info.version;
    fontData.info["6"] = fontData.info.fontName;

    const name = ttFont.ele("name");
    for(const k of Object.keys(fontData.info)) {
        const firstChar = k.charAt(0);
        if(firstChar > '0' && firstChar <= '9') {
            const attr = {nameID: k, platformID: "0", platEncID: "0", langID: "0x0"};
            let text = fontData.info[k];
            switch(typeof text) {
            case "string":
                break;
            case "number":
                text = fontData.info[text];
                break;
            case "object":
                if(Array.isArray(text)) {
                    let textOut = "";
                    for(let subt of text) {
                        if(typeof subt === "number") {
                            subt = fontData.info[subt];
                        }
                        textOut += subt;
                    }
                    text = textOut;
                    break;
                }
            default:
                throw new Error("Invalid text type");
            }
            name.ele("namerecord", attr).cdata(text);
            attr.platformID = "1";
            name.ele("namerecord", attr).cdata(text);
            attr.platformID = "3";
            attr.platEncID  = "1";
            attr.langID     = "0x0409";
            name.ele("namerecord", attr).cdata(text);
        }
    }

    // glyph ordering
    const GlyphOrder = ttFont.ele("GlyphOrder")
          .ele("GlyphID", {name: ".notdef"}).up();
    fontData.chars.forEach(function(ch) {
        GlyphOrder.ele("GlyphID", {name: ch.name});
    });
    fontData.layerDatum.forEach(function(layer) {
        GlyphOrder.ele("GlyphID", {name: layer.name});
    });

    // header
    ttFont.ele("head")
        .ele("tableVersion",       {value: "1.0"}).up()
        .ele("fontRevision",       {value: "1.0"}).up()
        .ele("checkSumAdjustment", {value: "0x0"}).up()
        .ele("magicNumber",        {value: "0x5f0f3cf5"}).up()
        .ele("flags",              {value: "00000000 00001011"}).up()
        .ele("created",            {value: dateFormat(new Date())}).up()
        .ele("unitsPerEm",         {value: "512"}).up()
        .ele("xMin",               {value: "0"}).up()
        .ele("yMin",               {value: "0"}).up()
        .ele("xMax",               {value: "512"}).up()
        .ele("yMax",               {value: "512"}).up()
        .ele("macStyle",           {value: "00000000 00000000"}).up()
        .ele("lowestRecPPEM",      {value: "16"}).up()
        .ele("fontDirectionHint",  {value: "0"}).up()
        .ele("indexToLocFormat",   {value: "0"}).up()
        .ele("glyphDataFormat",    {value: "0"}).up();

    // horizontal header
    ttFont.ele("hhea")
        .ele("tableVersion",        {value: "0x00010000"}).up()
        .ele("ascent",              {value: "466"}).up()
        .ele("descent",             {value: "-46"}).up()
        .ele("lineGap",             {value: "46"}).up()
        .ele("advanceWidthMax",     {value: "512"}).up()
        .ele("minLeftSideBearing",  {value: "0"}).up()
        .ele("minRightSideBearing", {value: "0"}).up()
        .ele("xMaxExtent",          {value: "512"}).up()
        .ele("caretSlopeRise",      {value: "1"}).up()
        .ele("caretSlopeRun",       {value: "0"}).up()
        .ele("caretOffset",         {value: "0"}).up()
        .ele("reserved0",           {value: "0"}).up()
        .ele("reserved1",           {value: "0"}).up()
        .ele("reserved2",           {value: "0"}).up()
        .ele("reserved3",           {value: "0"}).up()
        .ele("metricDataFormat",    {value: "0"}).up()
        .ele("numberOfHMetrics",    {value: "1"}).up();

    // max preportions
    ttFont.ele("maxp")
        .ele("tableVersion",          {value: "0x10000"}).up()
        .ele("maxZones",              {value: "2"}).up()
        .ele("maxTwilightPoints",     {value: "0"}).up()
        .ele("maxStorage",            {value: "1"}).up()
        .ele("maxFunctionDefs",       {value: "1"}).up()
        .ele("maxInstructionDefs",    {value: "0"}).up()
        .ele("maxStackElements",      {value: "64"}).up()
        .ele("maxSizeOfInstructions", {value: "0"}).up();

    // OS/2
    ttFont.ele("OS_2")
        .ele("version",             {value: "4"}).up()
        .ele("xAvgCharWidth",       {value: "512"}).up()
        .ele("usWeightClass",       {value: "400"}).up()
        .ele("usWidthClass",        {value: "5"}).up()
        .ele("fsType",              {value: "00000000 00000000"}).up()
        .ele("ySubscriptXSize",     {value: "512"}).up()
        .ele("ySubscriptYSize",     {value: "512"}).up()
        .ele("ySubscriptXOffset",   {value: "0"}).up()
        .ele("ySubscriptYOffset",   {value: "0"}).up()
        .ele("ySuperscriptXSize",   {value: "512"}).up()
        .ele("ySuperscriptYSize",   {value: "512"}).up()
        .ele("ySuperscriptXOffset", {value: "0"}).up()
        .ele("ySuperscriptYOffset", {value: "0"}).up()
        .ele("yStrikeoutSize",      {value: "5"}).up()
        .ele("yStrikeoutPosition",  {value: "251"}).up()
        .ele("sFamilyClass",        {value: "0"}).up()
        .ele("ulUnicodeRange1",     {value: "00000000 00000000 00000000 00000000"}).up()
        .ele("ulUnicodeRange2",     {value: "00000000 00000000 00000000 00000000"}).up()
        .ele("ulUnicodeRange3",     {value: "00000000 00000000 00000000 00000000"}).up()
        .ele("ulUnicodeRange4",     {value: "00000000 00000000 00000000 00000000"}).up()
        .ele("achVendID",           {value: fontData.info.vendor}).up()
        .ele("fsSelection",         {value: "00000000 01000000"}).up()
        .ele("sTypoAscender",       {value: "512"}).up()
        .ele("sTypoDescender",      {value: "0"}).up()
        .ele("sTypoLineGap",        {value: "46"}).up()
        .ele("usWinAscent",         {value: "466"}).up()
        .ele("usWinDescent",        {value: "46"}).up()
        .ele("ulCodePageRange1",    {value: "00000000 00000000 00000000 00000000"}).up()
        .ele("ulCodePageRange2",    {value: "00000000 00000000 00000000 00000000"}).up()
        .ele("sxHeight",            {value: "0"}).up()
        .ele("sCapHeight",          {value: "0"}).up()
        .ele("usDefaultChar",       {value: "0"}).up()
        .ele("usBreakChar",         {value: "0x0"}).up()
        .ele("usMaxContext",        {value: "0"}).up()
        .ele("panose")
        .ele("bFamilyType",         {value: "2"}).up()
        .ele("bSerifStyle",         {value: "0"}).up()
        .ele("bWeight",             {value: "5"}).up()
        .ele("bProportion",         {value: "9"}).up()
        .ele("bContrast",           {value: "0"}).up()
        .ele("bStrokeVariation",    {value: "0"}).up()
        .ele("bArmStyle",           {value: "0"}).up()
        .ele("bLetterForm",         {value: "0"}).up()
        .ele("bMidline",            {value: "0"}).up()
        .ele("bXHeight",            {value: "0"}).up();

    // empty loca - will be generated by the compiler
    ttFont.ele("loca");

    // horizontal layouts
    const hmtx = ttFont.ele("hmtx")
          .ele("mtx", {name: ".notdef", width: "512", lsb: "0"}).up();
    fontData.chars.forEach(function(ch) {
        hmtx.ele("mtx", {name: ch.name, width: "512", lsb: "0"});
    });
    fontData.layerDatum.forEach(function(layer) {
        hmtx.ele("mtx", {name: layer.name, width: "512", lsb: layer.lsb});
    });

    // character map
    const cmap = ttFont.ele("cmap");
    cmap.ele("tableVersion", {version: "0"});

    const format12 = cmap.ele("cmap_format_12", {
        platformID: "0",
        platEncID: "4",
        language: "0",
        format: "12",
        reserved: "0",
        length: (fontData.chars.length * 12).toString(),
        nGroups: fontData.chars.length.toString()
    });
    fontData.chars.forEach(function(ch) {
        format12.ele("map", {code: "0x" + ch.unicode, name: ch.name});
    });

    // glyphs
    const glyf = ttFont.ele("glyf")
          .ele("TTGlyph", {name: ".notdef"}).up();
    fontData.chars.forEach(function(ch) {
        glyf.ele("TTGlyph", {name: ch.name});
    });
    fontData.layerDatum.forEach(function(layer) {
        layer.func("TTGlyph", glyf);
    });

    // postscript header
    const extraNames = ttFont.ele("post")
          .ele("formatType",         {value: "2.0"}).up()
          .ele("italicAngle",        {value: "0.0"}).up()
          .ele("underlinePosition",  {value: "0"}).up()
          .ele("underlineThickness", {value: "0"}).up()
          .ele("isFixedPitch",       {value: "1"}).up()
          .ele("minMemType42",       {value: "0"}).up()
          .ele("maxMemType42",       {value: "0"}).up()
          .ele("minMemType1",        {value: "0"}).up()
          .ele("maxMemType1",        {value: "0"}).up()
          .ele("psNames").up()
          .ele("extraNames");
    fontData.chars.forEach(function(ch) {
        if(ch.unicode != "0") {
            extraNames.ele("psName", {name: ch.name});
        }
    });
    fontData.layerDatum.forEach(function(layer) {
        extraNames.ele("psName", {name: layer.name});
    });

    // greyscale printing
    ttFont.ele("gasp")
        .ele("gaspRange", {rangeMaxPPEM: "65535", rangeGaspBehavior: "2"}).up();

    // COLR table records the color layers that make up each colored
    // glyph
    const COLR = ttFont.ele("COLR")
          .ele("version", {value: 0}).up();
    fontData.chars.forEach(function(ch) {
        if(ch.unicode != "0") {
            const ColorGlyph = COLR.ele("ColorGlyph", {name: ch.name});
            ch.layers.forEach(function(lyr) {
                ColorGlyph.ele("layer", {colorID: fontData.colorToId[lyr.color], name: lyr.name});
            });
        }
    });

    // CPAL table maps color index values to RGB colors
    const palette = ttFont.ele("CPAL")
          .ele("version",           {value: 0}).up()
          .ele("numPaletteEntries", {value: fontData.colors.length}).up()
          .ele("palette",           {index: 0});
    let index = 0;
    fontData.colors.forEach(function(c) {
        if(c.substr(0, 3) == "url") {
            console.log("unexpected color: " + c);
            c = "#000000ff";
        }
        palette.ele("color", {index: index, value: c});
        index = index + 1;
    });

    // glyph class defs
    const GlyphClassDef = ttFont.ele("GDEF")
          .ele("Version",       {value: "0x0010000"}).up()
          .ele("GlyphClassDef", {Format: "2"});
    fontData.chars.forEach(function(ch) {
        GlyphClassDef.ele("ClassDef", {glyph: ch.name, "class": "1"});
    });
    fontData.layerDatum.forEach(function(layer) {
        GlyphClassDef.ele("ClassDef", {glyph: layer.name, "class": "1"});
    });

    fs.writeFileSync(fOutTtx, ttFont.end({pretty: true}));

    const fOutTtf = fBuildDir + "/" + fontData.info.fontName + ".ttf";

    unwrapProc(childProcess.spawnSync(
        "ttx",
        [
            "--recalc-timestamp",
            "-o",
            fOutTtf,
            fOutTtx
        ]
    ));
};

for(const fSourceDir of process.argv.slice(2)) {
    main(fSourceDir);
}

// EOF
