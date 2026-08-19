import { useState } from 'react';
import { Sparkline } from './Sparkline';
import { RiskBar } from './RiskBar';
import { ArrowTrendingUpIcon } from './icons/ArrowTrendingUpIcon';
import { IconButton } from './IconButton';
import { ChevronDownOutlineIcon } from './icons/ChevronDownOutlineIcon';
import { ChevronUpOutlineIcon } from './icons/ChevronUpOutlineIcon';
import {
    getFund,
    type PublicFundDetailView,
    type PublicFundView,
} from '../api';
import { fmtCoin, priceDelta } from '../format';

interface FundCardProps {
    fund: PublicFundView;
    onBuy?: (fund: PublicFundView) => void;
}

export function FundCard({ fund, onBuy }: FundCardProps) {
    const [expanded, setExpanded] = useState(false);
    const [detail, setDetail] = useState<PublicFundDetailView | null>(null);
    const [loadingDetail, setLoadingDetail] = useState(false);

    async function toggleExpanded() {
        if (!expanded && detail === null) {
            setLoadingDetail(true);
            try {
                setDetail(await getFund(fund.id));
            } catch {
                // Expanded area just shows nothing extra below the toggle - not
                // worth a dedicated error state for a detail panel.
            } finally {
                setLoadingDetail(false);
            }
        }
        setExpanded((prev) => !prev);
    }

    // Reuses the same sign-based coloring (--positive/--negative) the rest of
    // the app already uses for price deltas, by reconstructing a "previous"
    // value from the delta the server sent - see funds.md's locked decision
    // that both deltas color by actual sign, not a fixed color.
    const last7 = priceDelta(fund.nav - fund.last7DaysDelta, fund.nav);
    const allTime = priceDelta(fund.nav - fund.allTimeDelta, fund.nav);

    return (
        <div className="card fund-card">
            <div className="fund-card-top">
                <div className="fund-card-identity">
                    <h3 className="fund-card-name">{fund.name}</h3>
                    <div className="fund-card-meta">
                        <div className="fund-card-meta-row">
                            <span className="fund-card-risk-label">RISK</span>
                            <RiskBar risk={fund.risk} />
                        </div>
                        <span className="fund-card-fee">
                            FEE {(fund.feePct * 100).toFixed(2)}
                        </span>
                    </div>
                </div>

                <div className="fund-card-sparkline">
                    <Sparkline
                        prices={fund.sparkline}
                        width={140}
                        height={40}
                        animate
                    />
                </div>

                <div className="fund-card-values">
                    <div className="fund-card-value-block">
                        <span className="fund-card-nav-value">
                            {fmtCoin(fund.nav)}
                        </span>
                        <span className="fund-card-value-label">
                            Market Value
                        </span>
                    </div>
                    <div className="fund-card-value-block">
                        <span className={`fund-card-delta-value ${last7.cls}`}>
                            {last7.text.split(' ')[0]}
                        </span>
                        <span className="fund-card-value-label">
                            Last 7 Days
                        </span>
                    </div>
                    <div className="fund-card-value-block">
                        <span
                            className={`fund-card-delta-value ${allTime.cls}`}
                        >
                            {allTime.text.split(' ')[0]}
                        </span>
                        <span className="fund-card-value-label">All Time</span>
                    </div>
                </div>
            </div>

            <div className="fund-card-bottom">
                <p className="fund-card-description">{fund.description}</p>
                <IconButton
                    className="btn-affirm"
                    icon={<ArrowTrendingUpIcon className="icon-btn-icon" />}
                    label="Buy Now"
                    onClick={() => onBuy?.(fund)}
                    disabled={!onBuy}
                    title={onBuy ? undefined : 'Fund trading is coming soon'}
                />
            </div>

            <button
                type="button"
                className="fund-card-details-toggle"
                onClick={toggleExpanded}
            >
                Details
                {expanded ? (
                    <ChevronUpOutlineIcon className="fund-card-chevron" />
                ) : (
                    <ChevronDownOutlineIcon className="fund-card-chevron" />
                )}
            </button>

            <div
                className={
                    expanded
                        ? 'fund-card-details expanded'
                        : 'fund-card-details'
                }
            >
                <div>
                    {loadingDetail && <p className="subtitle">Loading...</p>}
                    {detail && (
                        <table className="fund-constituents-table">
                            <thead>
                                <tr>
                                    <th>Character</th>
                                    <th>Shares</th>
                                    <th>% of Fund</th>
                                    <th>Price</th>
                                </tr>
                            </thead>
                            <tbody>
                                {detail.constituents.map((c) => (
                                    <tr key={`${c.playerName}::${c.server}`}>
                                        <td>{c.playerName}</td>
                                        <td>{c.stockCount.toFixed(2)}</td>
                                        <td>
                                            {(c.percentOfFund * 100).toFixed(2)}
                                            %
                                        </td>
                                        <td>
                                            {c.price !== null
                                                ? fmtCoin(c.price)
                                                : '–'}
                                        </td>
                                    </tr>
                                ))}
                                {detail.constituents.length === 0 && (
                                    <tr>
                                        <td colSpan={4} className="subtitle">
                                            This fund has no constituents right
                                            now.
                                        </td>
                                    </tr>
                                )}
                            </tbody>
                        </table>
                    )}
                </div>
            </div>
        </div>
    );
}
