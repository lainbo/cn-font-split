import { HB } from "./hb.js";
import { timeRecordFormat } from "./utils/timeCount.js";
import { IOutputFile, Subset, SubsetResult } from "./interface.js";
import { FontType, convert } from "./font-converter.js";
import md5 from "md5";
import byteSize from "byte-size";
import { subsetToUnicodeRange } from "./utils/subsetToUnicodeRange.js";
import { IContext } from "./fontSplit/context.js";
import { getExtensionsByFontType } from "./utils/getExtensionsByFontType.js";
import { subsetFont } from "./subset.js";

/** 构建轮廓数据库，存储方式为桶存储 */
const createContoursMap = async () => {
    // TODO 等待适配
    const fs = await import("fs/promises");
    const buffer = await fs.readFile(
        "./node_modules/@chinese-fonts/font-contours/data/unicodes_contours.dat"
    );
    const a = new Uint8Array(buffer.buffer);
    const map = new Map<number, number>();
    let wasted = 0;
    for (let index = 0; index < a.length; index++) {
        const element = a[index];
        element !== 0 ? map.set(index, element) : wasted++;
    }
    return map;
};

/** 可以实现较为准确的数值切割，偏差大致在 10 kb 左右 */
export const autoSubset = async (
    face: HB.Face,
    hb: HB.Handle,
    subsetUnicode: number[],
    outputFile: IOutputFile,
    targetType: FontType,
    ctx: IContext,
    maxSize = 70 * 1024
) => {
    const ext = getExtensionsByFontType(targetType);
    const subsetMessage: SubsetResult = [];
    let sample = subsetUnicode;

    const contoursMap = await createContoursMap();

    // 模拟分包，计算单个分包包含 contours 数目
    const contoursBorder = await calcContoursBorder(
        hb,
        face,
        targetType,
        contoursMap,
        maxSize
    );

    let count = 0;
    let cache: number[] = [];
    const totalChunk: number[][] = [];
    for (const iterator of sample) {
        count += contoursMap.get(iterator) ?? contoursMap.get(0)!;
        if (count >= contoursBorder) {
            totalChunk.push(cache);
            cache = [];
            count = 0;
        } else {
            cache.push(iterator);
        }
    }
    console.log(totalChunk.map((i) => i.length));

    let index = 0;
    for (const chunk of totalChunk) {
        const start = performance.now();
        const [buffer, arr] = subsetFont(face, chunk, hb);
        const middle = performance.now();
        const transferred = await convert(
            new Uint8Array(buffer!.buffer),
            targetType
        );
        const end = performance.now();
        const outputMessage = await combine(
            outputFile,
            ext,
            transferred,
            Array.from(arr)
        );
        subsetMessage.push(outputMessage);
        record(
            ctx,
            transferred,
            start,
            middle,
            end,
            arr,
            index,
            outputMessage.hash
        );
        index++;
    }

    return subsetMessage;
};

async function calcContoursBorder(
    hb: HB.Handle,
    face: HB.Face,
    targetType: FontType,
    contoursMap: Map<number, number>,
    maxSize: number
) {
    const sample = face.collectUnicodes();
    const space = Math.floor(sample.length / 300);
    let sampleUnicode: number[] = [];
    for (let index = 0; index < sample.length; index += space) {
        const element = sample[index];
        sampleUnicode.push(element);
    }
    console.log(sampleUnicode.length);
    const [buffer, arr] = subsetFont(face, sampleUnicode, hb);
    const transferred = await convert(
        new Uint8Array(buffer!.buffer),
        targetType
    );

    const totalContours: number = arr.reduce((col, cur) => {
        return col + (contoursMap.get(cur) ?? contoursMap.get(0)!);
    }, 0);
    const ContoursPerByte = totalContours / transferred.byteLength;
    console.log(totalContours, transferred.byteLength);
    return maxSize * ContoursPerByte;
}

async function combine(
    outputFile: IOutputFile,
    ext: string,
    transferred: Uint8Array,
    subset: Subset
) {
    const hashName = md5(transferred);
    await outputFile(hashName + ext, transferred);

    return {
        size: transferred.byteLength,
        hash: hashName,
        path: hashName + ext,
        unicodeRange: subsetToUnicodeRange(subset),
        subset,
    };
}

async function record(
    ctx: IContext,

    transferred: Uint8Array,
    start: number,
    middle: number,
    end: number,
    unicodeInFont: Uint32Array,
    index: number,
    hash: string,
    isTwice = false
) {
    const arr = unicodeInFont;
    ctx.trace(
        [
            index,
            timeRecordFormat(start, middle),
            (arr.length / (middle - start)).toFixed(2) + "字符/ms",
            timeRecordFormat(middle, end),
            (arr.length / (end - middle)).toFixed(2) + "字符/ms",
            byteSize(transferred.byteLength) + "/" + arr.length,
            hash.slice(0, 7),
            isTwice,
        ].join(" \t")
    );
}