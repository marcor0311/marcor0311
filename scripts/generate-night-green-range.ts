import axios from 'axios';
import * as d3 from 'd3';
import { JSDOM } from 'jsdom';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import * as colors from './create-css-colors';
import * as contrib from './create-3d-contrib';
import * as template from './color-template';
import * as type from './type';

const main = async (): Promise<void> => {
    const token = process.env.GITHUB_TOKEN;
    const userName = process.env.USERNAME;
    const outputPath = process.env.OUTPUT_PATH;
    if (!token || !userName || !outputPath) {
        throw new Error('GITHUB_TOKEN, USERNAME, and OUTPUT_PATH are required');
    }

    const today = new Date();
    const targetMonth = new Date(
        Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - 6, 1),
    );
    const lastTargetMonthDay = new Date(
        Date.UTC(targetMonth.getUTCFullYear(), targetMonth.getUTCMonth() + 1, 0),
    ).getUTCDate();
    const fromDate = new Date(
        Date.UTC(
            targetMonth.getUTCFullYear(),
            targetMonth.getUTCMonth(),
            Math.min(today.getUTCDate(), lastTargetMonthDay),
        ),
    );
    const toDate = new Date(
        Date.UTC(
            today.getUTCFullYear(),
            today.getUTCMonth(),
            today.getUTCDate(),
            23,
            59,
            59,
        ),
    );
    const from = fromDate.toISOString();
    const to = toDate.toISOString();
    const query = `query($login: String!, $from: DateTime!, $to: DateTime!) {
        user(login: $login) {
            contributionsCollection(from: $from, to: $to) {
                contributionCalendar {
                    isHalloween
                    totalContributions
                    weeks {
                        contributionDays {
                            date
                            contributionCount
                            contributionLevel
                        }
                    }
                }
            }
        }
    }`;
    const response = await axios.post(
        'https://api.github.com/graphql',
        { query, variables: { login: userName, from, to } },
        { headers: { Authorization: `bearer ${token}` } },
    );
    if (response.data.errors?.length) {
        throw new Error(response.data.errors[0].message);
    }

    const contributionCalendar =
        response.data.data.user.contributionsCollection.contributionCalendar;
    const levelByName: Record<type.ContributionLevel, number> = {
        NONE: 0,
        FIRST_QUARTILE: 1,
        SECOND_QUARTILE: 2,
        THIRD_QUARTILE: 3,
        FOURTH_QUARTILE: 4,
    };
    const startDay = from.slice(0, 10);
    const endDay = to.slice(0, 10);
    type GraphqlContributionDay = {
        date: string;
        contributionCount: number;
        contributionLevel: type.ContributionLevel;
    };
    const contributionDays: GraphqlContributionDay[] = (
        contributionCalendar.weeks as Array<{
            contributionDays: GraphqlContributionDay[];
        }>
    )
        .flatMap((week) => week.contributionDays)
        .filter((day) => day.date >= startDay && day.date <= endDay);
    const calendar: type.CalendarInfo[] = contributionDays.map((day) => ({
            date: new Date(`${day.date}T00:00:00.000Z`),
            contributionCount: day.contributionCount,
            contributionLevel: levelByName[day.contributionLevel],
        }));
    if (calendar.length !== Math.floor((toDate.getTime() - fromDate.getTime()) / 86_400_000) + 1) {
        throw new Error(`Incomplete contribution range: received ${calendar.length} days`);
    }

    const userInfo: type.UserInfo = {
        isHalloween: contributionCalendar.isHalloween,
        contributionCalendar: calendar,
        contributesLanguage: [],
        totalContributions: contributionCalendar.totalContributions,
        totalCommitContributions: 0,
        totalIssueContributions: 0,
        totalPullRequestContributions: 0,
        totalPullRequestReviewContributions: 0,
        totalRepositoryContributions: 0,
        totalForkCount: 0,
        totalStargazerCount: 0,
    };

    const width = 1000;
    const height = 800;
    const settings = { ...template.NightGreenSettings, growingAnimation: false };
    const dom = new JSDOM('<!doctype html><html><body></body></html>');
    const svgNode = dom.window.document.createElementNS(
        'http://www.w3.org/2000/svg',
        'svg',
    );
    const svg = d3.select(svgNode) as unknown as d3.Selection<
        SVGSVGElement,
        unknown,
        null,
        unknown
    >;
    svg.attr('xmlns', 'http://www.w3.org/2000/svg')
        .attr('width', width)
        .attr('height', height)
        .attr('viewBox', `0 0 ${width} ${height}`)
        .attr('role', 'img')
        .attr('aria-labelledby', 'title desc');
    svg.append('title')
        .attr('id', 'title')
        .text('GitHub contributions over the last six months');
    svg.append('desc')
        .attr('id', 'desc')
        .text(
            `${userInfo.totalContributions} contributions from ${startDay} through ${endDay}.`,
        );
    svg.append('style').html(
        [
            '* { font-family: "Ubuntu", "Helvetica", "Arial", sans-serif; }',
            colors.createCssColors(settings),
        ].join('\n'),
    );
    contrib.addDefines(svg, settings);
    svg.append('rect')
        .attr('x', 0)
        .attr('y', 0)
        .attr('width', width)
        .attr('height', height)
        .attr('class', 'fill-bg');
    contrib.create3DContrib(svg, userInfo, 0, 0, width, height, settings, false);

    mkdirSync(dirname(outputPath), { recursive: true });
    writeFileSync(outputPath, `<?xml version="1.0" encoding="UTF-8"?>\n${svgNode.outerHTML}`);
    console.log(`Generated ${calendar.length} days from ${startDay} through ${endDay}`);
};

main().catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
});
