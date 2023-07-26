import { HB } from '../hb';
import { IOutputFile, InputTemplate, SubsetResult } from '../interface';
import { convert } from '../convert/font-converter';
import type { FontType } from '../utils/detectFormat';
import { IContext } from '../fontSplit/context';
import { getExtensionsByFontType } from '../utils/getExtensionsByFontType';
import { subsetFont } from '../subsetService/subsetFont';
import { createContoursMap } from './createContoursMap';
import { createRecord } from './createRecord';
import { recordToLog } from './recordToLog';

/** 可以实现较为准确的数值切割，偏差大致在 10 kb 左右 */
export const useSubset = async (
    face: HB.Face,
    hb: HB.Handle,
    totalChunk: number[][],
    outputFile: IOutputFile,
    targetType: FontType,
    ctx: IContext,
) => {
    const { input } = ctx.pick('input');
    const ext = getExtensionsByFontType(targetType);
    const subsetMessage: SubsetResult = [];

    ctx.trace('开始分包 分包数', totalChunk.length);


    if (input.threads) {
        await Promise.all(
            totalChunk.map(async (chunk, index) =>
                runSubSet(
                    face,
                    chunk,
                    hb,
                    input,
                    targetType,
                    outputFile,
                    ext,
                    subsetMessage,
                    ctx,
                    index
                )
            )
        );
    } else {
        let index = 0;
        for (const chunk of totalChunk) {
            await runSubSet(
                face,
                chunk,
                hb,
                input,
                targetType,
                outputFile,
                ext,
                subsetMessage,
                ctx,
                index
            );
            index++;
        }
    }
    ctx.trace('结束分包');
    return subsetMessage;
};
async function runSubSet(
    face: HB.Face,
    chunk: number[],
    hb: HB.Handle,
    input: InputTemplate,
    targetType: FontType,
    outputFile: IOutputFile,
    ext: string,
    subsetMessage: SubsetResult,
    ctx: IContext,
    index: number
) {
    const start = performance.now();
    const [buffer, arr] = subsetFont(face, chunk, hb, {});
    const middle = performance.now();
    if (!buffer) return;


    // 执行 ttf 文件转 woff2
    const service = input.threads?.service;
    const transferred = service
        ? await service.pool.exec('convert', [buffer, targetType], {
            transfer: [buffer.buffer],
        })
        : await convert(buffer, targetType);
    const end = performance.now();



    const outputMessage = await createRecord(
        outputFile,
        ext,
        transferred,
        Array.from(arr)
    );
    subsetMessage.push(outputMessage);
    recordToLog(
        ctx,
        transferred,
        start,
        middle,
        end,
        arr,
        index,
        outputMessage.hash
    );
}
import {
    FeatureMap,
    processSingleUnicodeWithFeature,
} from '../subsetService/featureMap';
/** 获取自动分包方案 */
export const getAutoSubset = (
    subsetUnicode: number[],
    contoursBorder: number,
    contoursMap: Map<number, number>,
    featureMap: FeatureMap,
) => {
    let count = 0;
    let cache: number[] = [];
    const totalChunk: number[][] = [];

    const defaultVal = contoursMap.get(0) as number;
    for (const unicode of subsetUnicode) {
        // featureMap 已经进行了去重
        const unicodeSet = processSingleUnicodeWithFeature(unicode, featureMap);

        const sum = unicodeSet.reduce(
            (col, cur) => col + (contoursMap.get(cur) ?? defaultVal),
            0
        );
        // contoursMap 0 是平均值
        count += sum;
        cache.push(...unicodeSet);

        if (count >= contoursBorder) {
            totalChunk.push(cache);
            cache = [];
            count = 0;
        }

    }
    if (cache.length) totalChunk.push(cache);

    // console.log(totalChunk.flat().length);
    return totalChunk;
};
